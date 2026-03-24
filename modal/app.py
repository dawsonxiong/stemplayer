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


@app.function(
    image=demucs_image,
    gpu="T4",
    timeout=300,
    container_idle_timeout=300,
    memory=8192,
    retries=1,
    secrets=[modal.Secret.from_name("r2-creds")],
)
@modal.web_endpoint(method="POST")
def separate_api(item: dict):
    """
    Called by Cloudflare Worker to trigger stem separation.

    Payload from Worker:
    {
        "task_id": "uuid",
        "input_r2_key": "uploads/uuid/song.mp3",
        "webhook_url": "https://stemplayer.xxx.workers.dev/api/webhook",
        "webhook_secret": "..."
    }

    R2 credentials come from Modal secrets, not the request body.
    """
    import boto3
    import requests

    task_id = item["task_id"]
    webhook_url = item["webhook_url"]
    webhook_secret = item["webhook_secret"]

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

            # Download from R2
            s3.download_file(bucket, item["input_r2_key"], input_path)

            # Run Demucs (htdemucs base model — ~25s on T4 for a 4-min track)
            subprocess.run(
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
                check=True,
            )

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

            # Webhook callback
            requests.post(
                webhook_url,
                json={"task_id": task_id, "status": "ready", "stems": stem_keys},
                headers={"x-webhook-secret": webhook_secret},
                timeout=10,
            )

        return {"task_id": task_id, "status": "complete"}

    except Exception as e:
        try:
            requests.post(
                webhook_url,
                json={"task_id": task_id, "status": "error", "error": str(e)},
                headers={"x-webhook-secret": webhook_secret},
                timeout=10,
            )
        except Exception:
            pass
        return {"task_id": task_id, "status": "error", "error": str(e)}
