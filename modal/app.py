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
        "requests==2.31.0",
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


@app.function(
    image=demucs_image,
    gpu="T4",
    timeout=900,
    scaledown_window=300,
    memory=8192,
    secrets=[modal.Secret.from_name("r2-creds"), webhook_secret],
)
def separate(task_id: str, input_r2_key: str, webhook_url: str):
    """Download from R2, run Demucs, upload stems, report back via webhook.

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
            input_path = os.path.join(tmpdir, "input_audio")
            output_dir = os.path.join(tmpdir, "output")

            progress(5)
            s3.download_file(bucket, input_r2_key, input_path)
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
                {"task_id": task_id, "status": "ready", "stems": stem_keys},
            )

        return {"task_id": task_id, "status": "complete"}

    except Exception as e:
        _report(
            webhook_url,
            {"task_id": task_id, "status": "error", "error": str(e)},
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
        "input_r2_key": "uploads/uuid/input.mp3",
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
            args = (item["task_id"], item["input_r2_key"], item["webhook_url"])
        except KeyError as e:
            raise HTTPException(status_code=400, detail=f"Missing {e}")

        separate.spawn(*args)
        return {"task_id": item["task_id"], "status": "queued"}

    return web
