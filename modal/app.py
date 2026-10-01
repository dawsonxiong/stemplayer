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


def _download_youtube(video_id: str, tmpdir: str) -> tuple[str, str | None]:
    """Fetch a video's best audio stream. Returns its path and title."""
    import yt_dlp

    url = f"https://www.youtube.com/watch?v={video_id}"
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
            # Look first, so a long video or a stream is turned away before
            # any of it downloads.
            info = ydl.extract_info(url, download=False)
            if info.get("is_live"):
                raise UserError("That video is a live stream. Try a regular video.")
            if (info.get("duration") or 0) > MAX_DURATION_MINUTES * 60:
                raise UserError(
                    f"That video is over {MAX_DURATION_MINUTES} minutes. Try a shorter one."
                )
            info = ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as e:
        # Private, age-restricted, region-locked, or YouTube refusing the
        # download. The detail goes to the logs, not the person.
        raise UserError(
            "That video couldn’t be downloaded. It may be private or age-restricted. "
            "Try another, or upload the song as a file."
        ) from e

    return info["requested_downloads"][0]["filepath"], info.get("title")


@app.function(
    image=demucs_image,
    gpu="T4",
    timeout=900,
    scaledown_window=300,
    memory=8192,
    secrets=[modal.Secret.from_name("r2-creds"), webhook_secret],
)
def separate(
    task_id: str,
    webhook_url: str,
    input_r2_key: str | None = None,
    youtube_id: str | None = None,
):
    """Fetch the song from R2 or YouTube, run Demucs, upload stems, report
    back via webhook.

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

            progress(5)
            if youtube_id:
                input_path, title = _download_youtube(youtube_id, tmpdir)
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
        "youtube_id": "dQw4w9WgXcQ",                # a YouTube video
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
        input_r2_key, youtube_id = item.get("input_r2_key"), item.get("youtube_id")
        if not (input_r2_key or youtube_id):
            raise HTTPException(status_code=400, detail="Missing input_r2_key or youtube_id")

        separate.spawn(
            task_id, webhook_url, input_r2_key=input_r2_key, youtube_id=youtube_id
        )
        return {"task_id": item["task_id"], "status": "queued"}

    return web
