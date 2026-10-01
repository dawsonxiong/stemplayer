import hmac
import modal
import os
import tempfile
import subprocess

app = modal.App("stem-demucs")

demucs_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "demucs==4.0.1",
        "torch==2.3.1",
        "torchaudio==2.3.1",
        "boto3==1.34.0",
        "requests==2.34.2",
        # yt-dlp needs a JavaScript runtime to solve YouTube's challenges. The
        # [default] extra brings the solver scripts, and deno, its default
        # runtime, comes as a wheel with the binary on PATH.
        "yt-dlp[default]==2026.8.19",
        "deno==2.9.7",
    )
    # Pre-download model weights into the image
    .run_commands(
        "python -c \"from demucs.pretrained import get_model; get_model('htdemucs')\""
    )
)

api_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]"
)

# WEBHOOK_SECRET, shared with the Worker. It authenticates the Worker's calls
# to this app and this app's callbacks to the Worker.
webhook_secret = modal.Secret.from_name("stemplayer-webhook")

# Matches MAX_DURATION_MINUTES in app/lib/constants.ts, which uploads are
# checked against in the browser.
MAX_DURATION_MINUTES = 10


class UserError(Exception):
    """A failure caused by the song rather than the system, worded for the
    person who asked for it. The Worker shows it as is."""


class YouTubeBlocked(UserError):
    """YouTube refused this server, not the song: worth trying another route."""


# APIFY_TOKEN, for downloading through Apify when YouTube refuses Modal.
apify_secret = modal.Secret.from_name("stemplayer-apify")


def _report(webhook_url: str, payload: dict) -> None:
    import requests

    try:
        requests.post(
            webhook_url,
            json=payload,
            headers={"x-webhook-secret": os.environ["WEBHOOK_SECRET"]},
            timeout=10,
        )
    except Exception:
        pass


def _sha256(path: str) -> str:
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


DOWNLOAD_FAILED = (
    "That song couldn’t be downloaded. It may be private, age-restricted or "
    "blocked in some regions. Try another link, or upload the song as a file."
)


YOUTUBE_REFUSED = (
    "YouTube isn’t letting us download right now. Try a SoundCloud link, "
    "or upload the song as a file."
)


def _download(url: str, tmpdir: str) -> dict:
    """Fetch a page's best audio stream. Returns yt-dlp's info, with the file
    at info["requested_downloads"][0]["filepath"]."""
    import yt_dlp

    opts = {
        "format": "bestaudio/best",
        # Demucs names its output folder after the input's file stem.
        "outtmpl": os.path.join(tmpdir, "input_audio.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            # Look first, so a long song, a stream or a preview is turned away
            # before any of it downloads.
            info = ydl.extract_info(url, download=False)
            if info.get("is_live"):
                raise UserError("That’s a live stream. Try a regular video.")
            if (info.get("duration") or 0) > MAX_DURATION_MINUTES * 60:
                raise UserError(
                    f"That song is over {MAX_DURATION_MINUTES} minutes. Try a shorter one."
                )
            # SoundCloud serves Go+ tracks to everyone else as a 30-second clip.
            formats = info.get("formats") or []
            if formats and all("preview" in (f.get("format_id") or "") for f in formats):
                raise UserError(
                    "SoundCloud only plays a 30-second preview of that track. "
                    "Try a YouTube link to it instead."
                )
            return ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as e:
        # YouTube asks servers it distrusts to sign in. That's about this
        # server, not the song, so say so rather than blame the link.
        if "confirm you’re not a bot" in str(e) or "confirm you're not a bot" in str(e):
            raise YouTubeBlocked(YOUTUBE_REFUSED) from e
        # The detail goes to the logs, not the person.
        raise UserError(DOWNLOAD_FAILED) from e


# Modal's addresses are shared cloud IPs, and YouTube asks most of them to
# sign in. This Apify actor fetches the audio through residential proxies
# instead and hands back a link to the file. It charges per minute of audio,
# plus proxy traffic, so it's only the fallback for a refused download.
APIFY_ACTOR = "lurkapi~youtube-to-mp3-audio-downloader"


def _download_via_apify(video_id: str, tmpdir: str) -> dict:
    """The same shape of result as _download, fetched by Apify instead."""
    import requests

    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise UserError(YOUTUBE_REFUSED)
    try:
        res = requests.post(
            f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/run-sync-get-dataset-items",
            params={"timeout": 240},
            headers={"Authorization": f"Bearer {token}"},
            json={
                "videoUrls": [f"https://www.youtube.com/watch?v={video_id}"],
                "audioFormat": "m4a",
                # The original stream, not re-encoded.
                "audioBitrate": "source",
                "maxVideosPerUrl": 1,
                # Its default datacenter proxies get refused too.
                "proxyConfiguration": {
                    "useApifyProxy": True,
                    "apifyProxyGroups": ["RESIDENTIAL"],
                },
            },
            timeout=270,
        )
        res.raise_for_status()
        items = res.json()
    except (requests.RequestException, ValueError) as e:
        raise UserError(YOUTUBE_REFUSED) from e

    item = items[0] if isinstance(items, list) and items else {}
    if item.get("status") != "Success" or not item.get("audioFileUrl"):
        raise UserError(YOUTUBE_REFUSED) from RuntimeError(f"Apify: {item.get('error')}")
    # Only known now: the refused page never gave a length.
    if (item.get("duration") or 0) > MAX_DURATION_MINUTES * 60:
        raise UserError(
            f"That song is over {MAX_DURATION_MINUTES} minutes. Try a shorter one."
        )

    path = os.path.join(tmpdir, "input_audio.m4a")
    with requests.get(item["audioFileUrl"], stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return {"title": item.get("title"), "requested_downloads": [{"filepath": path}]}


# Words that mark a different recording of a song: only a problem when the
# song's own title doesn't have them.
OTHER_VERSIONS = (
    "live", "cover", "karaoke", "instrumental", "sped up", "slowed", "nightcore",
    "8d", "remix", "reverb", "acoustic", "extended", "1 hour", "loop",
)


def _find_on_youtube(artist: str, title: str, duration_ms: int) -> dict:
    """The YouTube video most likely to be this exact recording.

    Searched by artist and title, then kept only if its length is within a few
    seconds of the song's, which rules out live takes, music videos with
    intros, and edits. Of those, official uploads win."""
    import yt_dlp

    target = duration_ms / 1000
    tolerance = max(3.0, target * 0.03)
    wanted = f"{artist} {title}".lower()

    with yt_dlp.YoutubeDL(
        {"quiet": True, "no_warnings": True, "extract_flat": True}
    ) as ydl:
        results = ydl.extract_info(f"ytsearch10:{artist} - {title}", download=False)

    best, best_score = None, None
    for rank, entry in enumerate(results.get("entries") or []):
        duration = entry.get("duration")
        video_title = (entry.get("title") or "").lower()
        channel = (entry.get("channel") or entry.get("uploader") or "").lower()
        if not entry.get("id") or duration is None or abs(duration - target) > tolerance:
            continue
        if any(word in video_title and word not in wanted for word in OTHER_VERSIONS):
            continue
        score = -rank
        # Auto-generated "Artist - Topic" uploads are the label's own audio.
        if channel.endswith(" - topic") or "vevo" in channel:
            score += 6
        if artist.lower() in channel:
            score += 4
        if title.lower() in video_title:
            score += 2
        score -= abs(duration - target)
        if best_score is None or score > best_score:
            best, best_score = entry, score

    if best is None:
        raise UserError(
            "That song couldn’t be found on YouTube. Paste a YouTube link to it instead."
        )
    return best


@app.function(
    image=demucs_image,
    gpu="T4",
    timeout=900,
    scaledown_window=300,
    memory=8192,
    secrets=[modal.Secret.from_name("r2-creds"), webhook_secret, apify_secret],
)
def separate(
    task_id: str,
    webhook_url: str,
    input_r2_key: str | None = None,
    youtube_id: str | None = None,
    soundcloud_id: str | None = None,
    match: dict | None = None,
):
    """Fetch the song, run Demucs, upload stems, report back via webhook.

    The song is an upload in R2, a YouTube video, a SoundCloud track, or a
    Spotify or Apple Music song (`match`) found on YouTube by artist, title
    and length.

    R2 credentials and the webhook secret come from Modal secrets, not the
    request body.
    """
    import boto3

    def progress(pct: int):
        _report(
            webhook_url,
            {"task_id": task_id, "status": "processing", "progress": pct},
        )

    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY"],
            aws_secret_access_key=os.environ["R2_SECRET_KEY"],
            region_name="auto",
        )

        bucket = os.environ["R2_BUCKET"]

        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = os.path.join(tmpdir, "output")
            title = None
            matched = None

            progress(5)
            if match:
                matched = _find_on_youtube(
                    match["artist"], match["title"], match["duration_ms"]
                )
                youtube_id = matched["id"]
            if youtube_id:
                url = f"https://www.youtube.com/watch?v={youtube_id}"
            elif soundcloud_id:
                url = f"https://api.soundcloud.com/tracks/{soundcloud_id}"
            else:
                url = None

            if url:
                try:
                    info = _download(url, tmpdir)
                except YouTubeBlocked:
                    if not youtube_id:
                        raise
                    info = _download_via_apify(youtube_id, tmpdir)
                input_path = info["requested_downloads"][0]["filepath"]
                title = info.get("title")
            else:
                input_path = os.path.join(tmpdir, "input_audio")
                s3.download_file(bucket, input_r2_key, input_path)
            input_sha256 = _sha256(input_path)
            progress(15)

            # Run Demucs (htdemucs base model — ~25s on T4 for a 4-min track)
            result = subprocess.run(
                [
                    "python", "-m", "demucs",
                    "-n", "htdemucs",
                    "--mp3",
                    "--mp3-bitrate", "192",
                    "-o", output_dir,
                    input_path,
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(f"demucs failed: {result.stderr[-2000:]}")

            progress(80)

            # Upload stems back to R2
            stems_dir = os.path.join(output_dir, "htdemucs", "input_audio")
            stem_keys = {}

            for stem_name in ["vocals", "drums", "bass", "other"]:
                local_path = os.path.join(stems_dir, f"{stem_name}.mp3")
                if not os.path.exists(local_path):
                    raise FileNotFoundError(f"Stem {stem_name}.mp3 not found")

                r2_key = f"stems/{task_id}/{stem_name}.mp3"
                s3.upload_file(
                    local_path, bucket, r2_key,
                    ExtraArgs={"ContentType": "audio/mpeg"},
                )
                stem_keys[stem_name] = r2_key

            _report(
                webhook_url,
                {
                    "task_id": task_id,
                    "status": "ready",
                    "stems": stem_keys,
                    # Lets the Worker recognise the same song uploaded again.
                    "input_sha256": input_sha256,
                    **({"title": title} if title else {}),
                    # The video a Spotify or Apple Music song was found as,
                    # shown so a wrong match is obvious, and cached so
                    # pasting that video reuses these stems.
                    **(
                        {
                            "matched_youtube_id": youtube_id,
                            "matched_title": title,
                        }
                        if matched
                        else {}
                    ),
                },
            )

        return {"task_id": task_id, "status": "complete"}

    except Exception as e:
        _report(
            webhook_url,
            {
                "task_id": task_id,
                "status": "error",
                "error": str(e.__cause__ or e),
                **({"user_error": str(e)} if isinstance(e, UserError) else {}),
            },
        )
        return {"task_id": task_id, "status": "error", "error": str(e)}


def _valid_input(given: dict) -> bool:
    import re

    if "input_r2_key" in given:
        return isinstance(given["input_r2_key"], str)
    if "youtube_id" in given:
        return bool(re.fullmatch(r"[A-Za-z0-9_-]{11}", str(given["youtube_id"])))
    if "soundcloud_id" in given:
        return bool(re.fullmatch(r"\d+", str(given["soundcloud_id"])))
    match = given["match"]
    return (
        isinstance(match, dict)
        and isinstance(match.get("artist"), str)
        and isinstance(match.get("title"), str)
        and isinstance(match.get("duration_ms"), int)
        and 0 < match["duration_ms"] <= MAX_DURATION_MINUTES * 60_000
    )


@app.function(image=api_image, secrets=[webhook_secret])
@modal.asgi_app()
def separate_api():
    """
    Called by the Cloudflare Worker to enqueue a separation job, with
    `Authorization: Bearer <WEBHOOK_SECRET>`.

    Payload from Worker:
    {
        "task_id": "uuid",
        "input_r2_key": "uploads/uuid/input.mp3",   # an upload, or
        "youtube_id": "dQw4w9WgXcQ",                # a YouTube video, or
        "soundcloud_id": "293",                     # a SoundCloud track, or
        "match": {"artist": "...", "title": "...",  # a song to find on YouTube
                  "duration_ms": 213573},
        "webhook_url": "https://stemplayer.xxx.workers.dev/api/webhook"
    }

    Spawns the GPU job and returns immediately — the Worker must not block
    for the full separation.
    """
    from fastapi import FastAPI, Header, HTTPException

    web = FastAPI()

    @web.post("/")
    def enqueue(item: dict, authorization: str = Header("")):
        expected = f"Bearer {os.environ['WEBHOOK_SECRET']}"
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="Unauthorized")

        try:
            task_id, webhook_url = item["task_id"], item["webhook_url"]
        except KeyError as e:
            raise HTTPException(status_code=400, detail=f"Missing {e}")
        # Each input is checked against its own shape: this endpoint builds
        # the URL yt-dlp fetches, so it never follows one it's handed.
        inputs = {
            "input_r2_key": item.get("input_r2_key"),
            "youtube_id": item.get("youtube_id"),
            "soundcloud_id": item.get("soundcloud_id"),
            "match": item.get("match"),
        }
        given = {k: v for k, v in inputs.items() if v}
        if len(given) != 1:
            raise HTTPException(status_code=400, detail="Give exactly one input")
        if not _valid_input(given):
            raise HTTPException(status_code=400, detail="Invalid input")

        separate.spawn(task_id, webhook_url, **given)
        return {"task_id": item["task_id"], "status": "queued"}

    return web
