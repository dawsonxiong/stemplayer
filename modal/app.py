import hmac
import json
import modal
import modal.experimental
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

app = modal.App("stem-demucs")

demucs_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        # demucs supplies the model and its weights; stemsep (vendored below)
        # runs it. torchaudio isn't used, but demucs imports it.
        "demucs==4.0.1",
        "torch==2.11.0",
        "torchaudio==2.11.0",
        "lameenc==1.8.4",
        # Decodes MP3, WAV, FLAC and Ogg in process; ffmpeg does the rest.
        "soundfile==0.14.0",
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
    .add_local_python_source("stemsep")
)

# For fetch_link: just what downloading needs, so it starts quickly.
fetch_image = (
    modal.Image.debian_slim(python_version="3.11")
    # yt-dlp fixes up HLS AAC downloads with it.
    .apt_install("ffmpeg")
    .pip_install("requests==2.34.2", "yt-dlp[default]==2026.8.19", "deno==2.9.7")
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
    """YouTube refused this server, not the song: worth trying another route,
    and worth the person trying again, since a new run gets a new server."""


# APIFY_TOKEN, for downloading through Apify when YouTube refuses Modal.
apify_secret = modal.Secret.from_name("stemplayer-apify")


_session = None


def _report(webhook_url: str, payload: dict) -> None:
    import requests

    # One session per container, so reports after the first reuse its
    # connection to the Worker instead of a new TLS handshake each (~0.3 s).
    global _session
    if _session is None:
        _session = requests.Session()
    # Twice, since the connection kept from the last song may have been
    # closed by now, and a lost "ready" would leave the song stuck.
    for _ in range(2):
        try:
            _session.post(
                webhook_url,
                json=payload,
                headers={"x-webhook-secret": os.environ["WEBHOOK_SECRET"]},
                timeout=10,
            )
            return
        except requests.ConnectionError:
            continue
        except Exception:
            return


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


AGE_RESTRICTED = (
    "That video is age-restricted, so it can’t be downloaded. "
    "Try another link, or upload the song as a file."
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
        # A single file over HLS. SoundCloud offers both for most tracks, and
        # bestaudio picks its 160k AAC in ~50 HLS fragments: 0.9–8.4 s to
        # download, against 0.07–1.1 s for the one 128k MP3 file, which also
        # decodes while it separates. YouTube's audio is a single file anyway.
        "format": "bestaudio[protocol^=http]/bestaudio/best",
        # For a track that's only on HLS, fetch its fragments 8 at a time.
        "concurrent_fragment_downloads": 8,
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
        # Or it lets the server look the video up and then refuses the audio.
        if "youtube.com" in url and "HTTP Error 403" in str(e):
            raise YouTubeBlocked(YOUTUBE_REFUSED) from e
        if "confirm your age" in str(e):
            raise UserError(AGE_RESTRICTED) from e
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
        raise YouTubeBlocked(YOUTUBE_REFUSED)
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
        raise YouTubeBlocked(YOUTUBE_REFUSED) from e

    item = items[0] if isinstance(items, list) and items else {}
    if item.get("status") != "Success" or not item.get("audioFileUrl"):
        raise YouTubeBlocked(YOUTUBE_REFUSED) from RuntimeError(f"Apify: {item.get('error')}")
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


# How fetch_link and its stand-ins run. For a video YouTube gates, it asked
# every container on AWS, Azure and Oracle (where the A10s are) to sign in,
# 21 of 21, and let most on Google Cloud through. It refuses an address, not
# a video, and containers in one region often share an address, so the
# stand-ins are in other regions. Apify, at 44–168 s and ~5–8¢ a song, is
# for when every one is refused (see _fetch).
FETCH_FUNCTION = dict(
    image=fetch_image, cloud="gcp", cpu=1.0, memory=1024, timeout=300, scaledown_window=60
)


def _fetch_link(url: str | None) -> dict:
    """A song link's audio as {"data", "ext", "title"}, or the UserError it
    met as {"error", "blocked", "cause"}, for _fetch to raise again. No
    url: nothing, to start a container ahead of a song."""
    if not url:
        return {}
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            info = _download(url, tmpdir)
        except UserError as e:
            if isinstance(e, YouTubeBlocked):
                # YouTube refuses an address, not a video, so this container
                # takes no more songs, which would only meet the same refusal.
                modal.experimental.stop_fetching_inputs()
            return {
                "error": str(e),
                "blocked": isinstance(e, YouTubeBlocked),
                "cause": repr(e.__cause__),
            }
        path = info["requested_downloads"][0]["filepath"]
        with open(path, "rb") as f:
            data = f.read()
    return {"data": data, "ext": os.path.splitext(path)[1], "title": info.get("title")}


# Pinning a narrow region costs 1.75x, on a second or two of one CPU.
@app.function(region="us-central", **FETCH_FUNCTION)
def fetch_link(url: str | None, youtube_id: str | None = None) -> dict:
    # `youtube_id` is unused, kept for GPU containers from before a deploy,
    # which go on taking songs for a while and still pass it.
    return _fetch_link(url)


@app.function(region="us-east", **FETCH_FUNCTION)
def fetch_link_east(url: str) -> dict:
    return _fetch_link(url)


@app.function(region="us-west", **FETCH_FUNCTION)
def fetch_link_west(url: str) -> dict:
    return _fetch_link(url)


@app.function(region="eu-west", **FETCH_FUNCTION)
def fetch_link_eu(url: str) -> dict:
    return _fetch_link(url)


# Where a refused YouTube download is tried again, all at once, before
# Apify. On 2026-10-10, with us-central refusing two videos on 2 of 3
# containers, us-east and eu-west let 3 of 3 through and us-west 2 of 3. A
# refusal comes back in ~1–1.7 s and a cold container downloads in ~5–7 s.
FETCH_STAND_INS = (fetch_link_east, fetch_link_west, fetch_link_eu)


def _fetch(url: str, youtube_id: str | None, tmpdir: str) -> tuple[str, str | None]:
    """Download a link's audio through fetch_link, retrying a YouTube refusal
    in other regions and then through Apify. Returns its path and title."""
    from concurrent.futures import as_completed

    got = fetch_link.remote(url)
    if got.get("blocked") and youtube_id:
        pool = ThreadPoolExecutor(len(FETCH_STAND_INS))
        tries = [pool.submit(fn.remote, url) for fn in FETCH_STAND_INS]
        for done in as_completed(tries):
            try:
                result = done.result()
            except Exception:
                continue  # one container failing isn't the song's fault
            # Only the audio itself wins: a stand-in can fail for its own
            # reasons, as a video blocked in its region, and the first
            # refusal already says the song itself is fine.
            if "data" in result:
                got = result
                break
        # The others finish on their own; the song doesn't wait for them.
        pool.shutdown(wait=False, cancel_futures=True)
    if got.get("blocked") and youtube_id:
        info = _download_via_apify(youtube_id, tmpdir)
        return info["requested_downloads"][0]["filepath"], info.get("title")
    if "error" in got:
        error = YouTubeBlocked if got["blocked"] else UserError
        raise error(got["error"]) from RuntimeError(got["cause"])
    path = os.path.join(tmpdir, "input_audio" + got["ext"])
    with open(path, "wb") as f:
        f.write(got["data"])
    return path, got["title"]


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


STEMS = ("vocals", "drums", "bass", "other")


# How stemsep runs Demucs, chosen by benchmark (github.com/dawsonxiong/stemsep):
# chunks batched 8 to a pass, half precision, and 10% overlap between chunks
# rather than demucs's 25%. On an A10 a 4-minute song separates in 1.9 s,
# against 5.5 s for demucs's apply_model, and on 12 full MUSDB18 songs its
# SDR is within 0.02 dB of demucs's.
SEPARATOR_CONFIG = dict(overlap=0.10, batch_size=8, precision="fp16")

# Stems are stored 6 dB down and turned back up by the player. Loud masters'
# stems peak past full scale (a commercial track's drums at 1.64), and
# demucs's way of keeping them from clipping, scaling each such stem down on
# its own, left the drums 4.4 dB too quiet against the rest and had to wait
# for the whole stem before encoding it. At 0.5 they fit, at a cost of 0.015
# dB in the MP3's fidelity. A stem past ~2 is still scaled down, and its
# reported gain says by how much, so the mix still adds up to the song.
STEM_GAIN = 0.5

UNREADABLE = "That file couldn’t be read as audio. Try another file, or a link to the song."


def _decode(separator, input_path: str, uploaded: bool):
    """The song as a [channels, length] tensor at the model's sample rate."""
    from stemsep.audio import DecodeError, decode

    try:
        return decode(input_path, separator.samplerate, separator.audio_channels)
    except DecodeError as e:
        # An upload that won't decode is the person's file. A download that
        # won't is ours to retry, so it stays a plain error.
        if uploaded:
            raise UserError(UNREADABLE) from e
        raise


def _ffmpeg_blocks(path: str, samplerate: int, channels: int, seconds: float = 2.0):
    """decode_blocks for what libsndfile can't read, as YouTube's Opus and
    AAC: ffmpeg decodes on a pipe, so separating starts at its first block
    (0.4–0.7 s) rather than after the whole song (0.5–1.2 s). The same
    samples as decode, to the bit, remixed as it does."""
    import subprocess

    import numpy as np
    import torch
    from stemsep.audio import NotStreamable

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=channels", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )  # fmt: skip
    try:
        src = int(probe.stdout.split()[0])
    except (IndexError, ValueError):
        raise NotStreamable("ffprobe found no audio")
    if channels != 2:
        raise NotStreamable(f"{channels} channels")
    # Mono to both sides, and only the first two of more, as decode does.
    pan = f"pan=stereo|c0=c0|c1={'c0' if src == 1 else 'c1'}"
    proc = subprocess.Popen(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-map", "0:a:0", "-af", pan, "-ar", str(samplerate),
         "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )  # fmt: skip
    frame = 4 * channels
    size = int(seconds * samplerate) * frame
    got = 0
    with proc:
        while buf := proc.stdout.read(size):
            buf = buf[: len(buf) // frame * frame]
            got += len(buf)
            block = np.frombuffer(buf, "<f4").reshape(-1, channels)
            yield torch.from_numpy(block.T.copy())
        err = proc.stderr.read()
    # Either way the song is decoded again whole, which reports the error.
    if proc.returncode:
        raise NotStreamable(err.decode(errors="replace")[-500:])
    if not got:
        raise NotStreamable("no audio")


def _blocks(path: str, samplerate: int, channels: int):
    """decode_blocks, or ffmpeg's if libsndfile can't open the file."""
    from stemsep.audio import NotStreamable, decode_blocks

    blocks = decode_blocks(path, samplerate, channels)
    try:
        first = next(blocks)
    except NotStreamable:
        yield from _ffmpeg_blocks(path, samplerate, channels)
        return
    except StopIteration:
        return
    yield first
    yield from blocks


def _prefetch(blocks):
    """`blocks`, produced on a thread as fast as it can, so the next is
    usually ready when it's asked for. An exception reaches the reader."""
    import queue
    import threading

    q = queue.Queue()
    end = object()

    def produce():
        try:
            for block in blocks:
                q.put(block)
            q.put(end)
        except BaseException as e:
            q.put(e)

    def read():
        while (item := q.get()) is not end:
            if isinstance(item, BaseException):
                raise item
            yield item

    # Started here, not on the first read: a generator's body only runs
    # once it's asked for a block, which is after the warm-up.
    threading.Thread(target=produce, daemon=True).start()
    return read()


def _run_demucs(separator, wav=None, blocks=None, sink=None) -> dict:
    """Split a song into its stems with the separator's model, on whichever
    device it's on, handing each stretch to `sink` as it's finished. The
    song is `wav`, or `blocks` of it as they're decoded."""
    from stemsep.audio import NotStreamable

    try:
        if blocks is not None:
            return separator.separate_stream(blocks, sink=sink)
        return separator.separate(wav, sink=sink)
    except NotStreamable:
        raise  # the decoder's, not the GPU's: decode it whole instead
    except Exception:
        # A GPU error can leave CUDA unusable for the rest of the process, and
        # the model stays loaded for later songs. So this container finishes
        # this song and takes no more, and the next song gets a fresh one.
        modal.experimental.stop_fetching_inputs()
        raise


@app.cls(
    image=demucs_image,
    # A 4-minute song takes ~5.7 s on an A10 from decoding to the last MP3,
    # against ~8.1 s on an L4 and ~8.5 s on a T4: most of a job is now
    # decoding and encoding on the CPU, and A10 hosts have faster ones. At
    # about 0.21¢ a song it costs within 10% of a T4, and less than an L4.
    gpu="A10",
    # Left to choose, Modal put A10s in Frankfurt, where the bucket (eastern
    # North America) and the webhook were far enough away to make a split
    # ~2 s slower: 10.4 s from Split to playable against 8.4 s pinned here.
    # It costs 15% more per GPU-second, about 0.03¢ a song.
    region="us",
    # Decoding, MP3 encoding and uploads run on the CPU, one core per stem.
    cpu=4.0,
    timeout=900,
    # An idle A10 costs ~0.04¢ a second, more than a song every 6 seconds:
    # the wait after the last song was most of the bill. A GPU now starts as
    # soon as a song is picked, so a cold one costs ~1–2 s by the time it's
    # needed. A minute covers songs split back to back; after listening to
    # one, the next would have found the GPU gone anyway.
    scaledown_window=60,
    memory=8192,
    secrets=[modal.Secret.from_name("r2-creds"), webhook_secret, apify_secret],
    # A cold start restores torch and the loaded model from a snapshot
    # instead of importing and loading them again.
    enable_memory_snapshot=True,
)
class Separator:
    @modal.enter(snap=True)
    def load_model(self):
        from stemsep import Config, Separator as Stemsep

        # No GPU while the snapshot is taken, so the model loads on the CPU.
        self.separator = Stemsep("htdemucs", Config(**SEPARATOR_CONFIG), device="cpu")

    @modal.enter(snap=False)
    def move_to_gpu(self):
        import threading

        # Kept on the GPU between songs.
        self.separator.to("cuda")
        # A container's first separation spends ~1.2 s loading CUDA kernels
        # and setting up its libraries. Doing that on a throwaway clip now,
        # alongside the first song's download and decoding, takes it off
        # that song's wait.
        self.warmup = threading.Thread(target=self._warm_up, daemon=True)
        self.warmup.start()

    def _warm_up(self):
        import torch

        try:
            # Short, so its own GPU time stays small: the kernels it loads
            # are what the song needs, at any batch size.
            self.separator.separate(torch.randn(2, 44100 * 20) * 0.1, sink=lambda _: None)
        except Exception:
            pass  # the song's own separation will meet any real problem

    @modal.method()
    def warm(self, hold: float = 0) -> None:
        """Nothing: getting a container started, and so loaded and warmed
        up, before the song it's for has finished uploading is the point.

        `hold` keeps it busy that long, so that calls made together each get
        a container of their own (see .github/workflows/deploy-modal.yml)."""
        time.sleep(min(hold, 30))

    @modal.method()
    def separate(self, task_id: str, webhook_url: str, **song):
        """Fetch the song, run Demucs, upload stems, report back via webhook.

        The song (`song`, one of `input_r2_key`, `youtube_id`, `soundcloud_id`
        or `match`) is an upload in R2, a YouTube video, a SoundCloud track,
        or a Spotify or Apple Music song found on YouTube by artist, title and
        length.

        R2 credentials and the webhook secret come from Modal secrets, not the
        request body.
        """
        return _separate(self.separator, task_id, webhook_url, warmup=self.warmup, **song)


def _separate(
    separator,
    task_id: str,
    webhook_url: str,
    warmup=None,
    input_r2_key: str | None = None,
    youtube_id: str | None = None,
    soundcloud_id: str | None = None,
    match: dict | None = None,
):
    import boto3
    from stemsep.audio import NotStreamable, StreamingMP3

    # Seconds per stage, logged with each job and returned to the caller.
    timings: dict[str, float] = {}

    @contextmanager
    def timed(stage: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            timings[stage] = round(time.perf_counter() - start, 3)

    # Progress reports go out from one thread, in order, while the job carries
    # on. They're drained before the final report, so a late "processing"
    # can't land after "ready" or "error".
    reporter = ThreadPoolExecutor(1)

    def progress(pct: int):
        reporter.submit(
            _report,
            webhook_url,
            {"task_id": task_id, "status": "processing", "progress": pct},
        )

    try:
        with timed("r2_client"):
            s3 = boto3.client(
                "s3",
                endpoint_url=os.environ["R2_ENDPOINT"],
                aws_access_key_id=os.environ["R2_ACCESS_KEY"],
                aws_secret_access_key=os.environ["R2_SECRET_KEY"],
                region_name="auto",
            )

        bucket = os.environ["R2_BUCKET"]

        with tempfile.TemporaryDirectory() as tmpdir:
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

            with timed("fetch"):
                if url:
                    input_path, title = _fetch(url, youtube_id, tmpdir)
                else:
                    input_path = os.path.join(tmpdir, "input_audio")
                    s3.download_file(bucket, input_r2_key, input_path)
                input_sha256 = _sha256(input_path)
            progress(15)

            # The stems encode to MP3 as they come off the GPU, one LAME per
            # stem on its own core, rather than all after it.
            def new_encoder():
                return StreamingMP3(
                    STEMS, separator.samplerate, separator.audio_channels, gain=STEM_GAIN
                )

            # Songs decode while they separate, on a thread from now, so a
            # new container's warm-up overlaps it too: MP3, WAV, FLAC and Ogg
            # in process, anything else through ffmpeg. One libsndfile would
            # read short, or ffmpeg fails on, is decoded whole first.
            blocks = _prefetch(
                _blocks(input_path, separator.samplerate, separator.audio_channels)
            )
            encoder = new_encoder()
            try:
                with timed("warmup_wait"):
                    if warmup is not None:
                        warmup.join()
                with timed("separate"):
                    try:
                        stems = _run_demucs(separator, blocks=blocks, sink=encoder.feed)
                    except NotStreamable as e:
                        stems = None
                        # Why it's decoded whole after all, which costs ~0.6 s:
                        # the decoder's reason and what kind of file it was.
                        print(json.dumps({
                            "task_id": task_id,
                            "not_streamable": str(e)[-500:],
                            "input": os.path.splitext(input_path)[1] or "upload",
                            "bytes": os.path.getsize(input_path),
                        }))  # fmt: skip
                # Outside the except, so the aborted try's GPU buffers, which
                # its traceback would keep alive, are freed first.
                if stems is None:
                    encoder.close()
                    encoder = new_encoder()
                    with timed("decode"):
                        wav = _decode(separator, input_path, uploaded=not url)
                    with timed("separate_whole"):
                        stems = _run_demucs(separator, wav, sink=encoder.feed)
                progress(80)
                with timed("encode"):
                    mp3s = encoder.finish(stems)
            finally:
                encoder.close()

            stem_keys = {name: f"stems/{task_id}/{name}.mp3" for name in STEMS}

            def upload(name: str) -> None:
                s3.put_object(
                    Bucket=bucket, Key=stem_keys[name], Body=mp3s[name],
                    ContentType="audio/mpeg",
                )

            with timed("upload"), ThreadPoolExecutor(len(STEMS)) as pool:
                list(pool.map(upload, STEMS))

            with timed("report_ready"):
                # Progress still queued is moot now; the one in flight finishes.
                reporter.shutdown(wait=True, cancel_futures=True)
                _report(
                    webhook_url,
                    {
                        "task_id": task_id,
                        "status": "ready",
                        "stems": stem_keys,
                        # Lets the Worker recognise the same song uploaded again.
                        "input_sha256": input_sha256,
                        # What each stem was stored at, for the player to undo.
                        "stem_gains": encoder.gains,
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

        print(json.dumps({"task_id": task_id, "timings": timings}))
        return {"task_id": task_id, "status": "complete", "timings": timings}

    except Exception as e:
        reporter.shutdown(wait=True, cancel_futures=True)
        _report(
            webhook_url,
            {
                "task_id": task_id,
                "status": "error",
                "error": str(e.__cause__ or e),
                **({"user_error": str(e)} if isinstance(e, UserError) else {}),
                # Only a refusal might go differently next time; a song that's
                # too long or age-restricted won't.
                **({"retryable": True} if isinstance(e, YouTubeBlocked) else {}),
            },
        )
        return {"task_id": task_id, "status": "error", "error": str(e)}

    finally:
        # Modal's cancellation of an input isn't an Exception, so it skips the
        # handler above; don't leave its reports to mix with the next song's.
        reporter.shutdown(wait=False, cancel_futures=True)


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


# Every song goes through this endpoint before a GPU starts, and a cold one
# took 3–6 s to answer against ~0.65 s warm. It's a sliver of CPU, so it
# stays up 20 minutes after a request, for ~0.2¢. (A memory snapshot saved
# under a second on a cold start, and cost 7–10 s whenever it was retaken.)
@app.function(image=api_image, secrets=[webhook_secret], scaledown_window=1200)
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
    import threading

    from fastapi import FastAPI, Header, HTTPException

    web = FastAPI()
    last_warm = 0.0
    # FastAPI runs these handlers on a thread pool.
    warm_lock = threading.Lock()

    def authorized(authorization: str) -> None:
        expected = f"Bearer {os.environ['WEBHOOK_SECRET']}"
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="Unauthorized")

    @web.get("/health")
    def health():
        """Nothing: a page load calls it so this container is up by the time
        someone picks a song, rather than starting cold in front of it."""
        return {"ok": True}

    @web.post("/warm", status_code=202)
    def warm(authorization: str = Header("")):
        """Called when someone picks a song, so a GPU container starts while
        it uploads. At most once a minute: a container stays up a minute after
        its last input, and a burst of picks shouldn't start a crowd."""
        nonlocal last_warm
        authorized(authorization)
        with warm_lock:
            now = time.monotonic()
            if now - last_warm < 60:
                return {"status": "warming"}
            last_warm = now
        Separator().warm.spawn()
        # A cold fetch_link adds ~5 s to a link's download; warm, ~0.5 s.
        fetch_link.spawn(None)
        return {"status": "warming"}

    @web.post("/")
    def enqueue(item: dict, authorization: str = Header("")):
        authorized(authorization)

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

        Separator().separate.spawn(task_id, webhook_url, **given)
        return {"task_id": item["task_id"], "status": "queued"}

    return web
