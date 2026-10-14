from __future__ import annotations

import asyncio
import hashlib
import io
import os
import shutil
import tempfile
import time
import wave
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.actor import current_actor
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.models.entities import User
from app.services.meal_assistant import VOICE_JOB_TYPE, owned_job, reserve

MAX_AUDIO_BYTES = 6 * 1024 * 1024
_transcripts: dict[str, tuple[float, str]] = {}
_decode_slots = asyncio.Semaphore(1)


def voice_available() -> bool:
    return bool(
        settings.nutrition_voice_enabled and shutil.which("ffmpeg") and shutil.which("prlimit")
    )


def audio_format(content: bytes, mime: str) -> str:
    if mime in {"audio/webm", "video/webm"} and content.startswith(b"\x1aE\xdf\xa3"):
        return "matroska"
    if mime in {"audio/mp4", "video/mp4", "audio/x-m4a"} and content[4:8] == b"ftyp":
        return "mov"
    if mime in {"audio/wav", "audio/x-wav"} and content[:4] == b"RIFF" and content[8:12] == b"WAVE":
        return "wav"
    raise HTTPException(422, "Record a WebM, MP4 or WAV audio clip.")


async def normalized_audio(content: bytes, mime: str) -> bytes:
    if not content or len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Record up to 60 seconds and 6 MB.")
    demux = audio_format(content, mime.split(";")[0])
    if _decode_slots.locked():
        raise HTTPException(503, "Voice is busy. Try again shortly or type your meal.")
    path: str | None = None
    process: asyncio.subprocess.Process | None = None
    async with _decode_slots:
        try:
            with tempfile.NamedTemporaryFile(
                prefix="meal-audio-", dir="/tmp", delete=False
            ) as handle:
                path = handle.name
                os.chmod(path, 0o600)
                handle.write(content)
            arguments = [
                "prlimit",
                "--as=536870912",
                "--stack=1048576",
                "--cpu=5",
                "--nofile=32",
                "--",
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-filter_threads",
                "1",
                "-filter_complex_threads",
                "1",
                "-protocol_whitelist",
                "file,pipe",
                "-f",
                demux,
            ]
            if demux == "mov":
                arguments += ["-enable_drefs", "0", "-use_absolute_path", "0"]
            arguments += [
                "-threads",
                "1",
                "-i",
                path,
                "-map",
                "0:a:0",
                "-vn",
                "-sn",
                "-dn",
                "-threads",
                "1",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-t",
                "61",
                "-f",
                "s16le",
                "pipe:1",
            ]
            process = await asyncio.create_subprocess_exec(
                *arguments,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
            pcm, _ = await asyncio.wait_for(process.communicate(), timeout=8)
            if process.returncode or not pcm or len(pcm) > 60 * 16000 * 2:
                raise HTTPException(422, "Use a readable recording of 60 seconds or less.")
            output = io.BytesIO()
            with wave.open(output, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(pcm)
            return output.getvalue()
        except (TimeoutError, OSError, ValueError):
            raise HTTPException(422, "Use a readable recording of 60 seconds or less.") from None
        finally:
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            if path:
                os.unlink(path)


async def transcribe(
    db: Session, user: User, request_id: str, content: bytes, mime: str
) -> dict[str, Any]:
    if not voice_available():
        raise HTTPException(503, "Voice recording is unavailable. You can type your meal.")
    if not content or len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Record up to 60 seconds and 6 MB.")
    audio_format(content, mime.split(";")[0])
    job, fresh = reserve(db, user, request_id, hashlib.sha256(content).hexdigest(), VOICE_JOB_TYPE)
    key = f"{user.id}:{request_id}"
    for expired in [key for key, (until, _) in _transcripts.items() if until <= time.monotonic()]:
        del _transcripts[expired]
    if not fresh:
        owned_job(db, user, request_id, VOICE_JOB_TYPE)
        if key in _transcripts:
            return {"text": _transcripts[key][1]}
        raise HTTPException(409 if job.status == "running" else 410, "Record your meal again.")
    try:
        await run_in_threadpool(
            auth_rate_limiter.check,
            "nutrition:audio:decode:global",
            settings.ai_daily_dispatch_budget,
            86400,
        )
        wav = await normalized_audio(content, mime)
        actor = current_actor.get()
        if not actor:
            raise ValueError("Authenticated account required")
        await run_in_threadpool(
            auth_rate_limiter.reserve,
            [
                ("ai:dispatch:global", settings.ai_daily_dispatch_budget, 86400),
                (f"ai:dispatch:user:{actor.user_id}", settings.ai_premium_daily_attempts, 86400),
            ],
        )
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                data={"model": settings.nutrition_transcription_model},
                files={"file": ("meal.wav", wav, "audio/wav")},
            )
            response.raise_for_status()
            text = str(response.json().get("text", "")).strip()
            if not text or len(text) > 4000:
                raise ValueError("Invalid transcript")
        if len(_transcripts) >= 100:
            _transcripts.pop(next(iter(_transcripts)))
        until = time.monotonic() + 300
        _transcripts[key] = (until, text)
        asyncio.get_running_loop().call_later(
            300,
            lambda: (
                _transcripts.pop(key, None) if _transcripts.get(key, (0, ""))[0] == until else None
            ),
        )
        job.status = "succeeded"
        db.commit()
        return {"text": text}
    except Exception as error:
        db.rollback()
        job.status = "failed"
        job.error_message = "Recording could not be transcribed."
        db.commit()
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(503, "Could not transcribe. Try typing your meal.") from None
