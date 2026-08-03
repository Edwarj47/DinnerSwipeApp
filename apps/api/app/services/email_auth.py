# ruff: noqa: E501

from __future__ import annotations

import hashlib
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage

import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.entities import EmailVerificationToken, PasswordResetToken, User

logger = structlog.get_logger()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_token() -> str:
    return secrets.token_urlsafe(48)


def _logo_html() -> str:
    return (
        '<div style="width:64px;height:64px;border-radius:999px;background:#fff;'
        "border:4px solid #ffd9d6;display:flex;align-items:center;justify-content:center;"
        "font-family:Georgia,serif;font-style:italic;font-weight:900;color:#d71920;"
        'font-size:25px;margin:0 auto 18px;">DS</div>'
    )


def _email_shell(title: str, body: str, button_label: str, button_url: str) -> str:
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#fff6f3;font-family:Arial,Helvetica,sans-serif;color:#24211f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff6f3;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #eaded2;border-radius:12px;padding:28px;">
            <tr><td align="center">{_logo_html()}</td></tr>
            <tr><td><h1 style="font-size:26px;line-height:32px;margin:0 0 12px;color:#24211f;">{title}</h1></td></tr>
            <tr><td><p style="font-size:16px;line-height:24px;margin:0 0 22px;color:#756f68;">{body}</p></td></tr>
            <tr>
              <td align="center">
                <a href="{button_url}" style="display:inline-block;background:#d71920;color:#ffffff;text-decoration:none;font-weight:800;border-radius:8px;padding:14px 18px;">{button_label}</a>
              </td>
            </tr>
            <tr><td><p style="font-size:12px;line-height:18px;margin:24px 0 0;color:#756f68;">If you did not request this, you can ignore this email.</p></td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _send_html_email(to_email: str, subject: str, html: str, text: str) -> bool:
    if not settings.smtp_configured:
        logger.info("email_delivery_skipped", reason="smtp_not_configured", subject=subject)
        return False
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{settings.email_from_name} <{settings.email_from}>"
    message["To"] = to_email
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    if settings.email_smtp_use_ssl:
        with smtplib.SMTP_SSL(
            settings.email_smtp_host, settings.email_smtp_port, timeout=20
        ) as smtp:
            smtp.login(settings.email_smtp_username, settings.email_smtp_password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(settings.email_smtp_host, settings.email_smtp_port, timeout=20) as smtp:
            if settings.email_smtp_use_tls:
                smtp.starttls()
            smtp.login(settings.email_smtp_username, settings.email_smtp_password)
            smtp.send_message(message)
    return True


def create_email_verification(db: Session, user: User) -> bool:
    token = _new_token()
    row = EmailVerificationToken(
        user_id=user.id,
        token_hash=_hash_token(token),
        expires_at=datetime.utcnow() + timedelta(minutes=settings.email_token_minutes),
    )
    db.add(row)
    db.commit()
    verify_url = f"{settings.public_api_url.rstrip('/')}/api/v1/auth/verify-email?token={token}"
    html = _email_shell(
        "Verify your Dinner Swipe email",
        "Confirm this email address so your household invites, voting, and account recovery stay protected.",
        "Verify email",
        verify_url,
    )
    text = f"Verify your Dinner Swipe email: {verify_url}"
    try:
        return _send_html_email(user.email, "Verify your Dinner Swipe email", html, text)
    except Exception as exc:
        logger.warning(
            "email_delivery_failed", purpose="verification", error_type=type(exc).__name__
        )
        return False


def verify_email_token(db: Session, token: str) -> User:
    row = db.scalar(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token_hash == _hash_token(token)
        )
    )
    if not row or row.used_at is not None or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Verification link is invalid or expired")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Verification link is invalid or expired")
    row.used_at = datetime.utcnow()
    user.email_verified = True
    user.email_verified_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def create_password_reset(db: Session, email: str) -> bool:
    user = db.scalar(select(User).where(User.email == email.lower(), User.is_active.is_(True)))
    if not user:
        return False
    token = _new_token()
    row = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_token(token),
        expires_at=datetime.utcnow() + timedelta(minutes=settings.password_reset_token_minutes),
    )
    db.add(row)
    db.commit()
    reset_url = f"{settings.app_public_url.rstrip('/')}/profile?reset_token={token}"
    html = _email_shell(
        "Reset your Dinner Swipe password",
        "Use this secure reset link to choose a new password. The link expires shortly.",
        "Reset password",
        reset_url,
    )
    text = f"Reset your Dinner Swipe password: {reset_url}"
    try:
        return _send_html_email(user.email, "Reset your Dinner Swipe password", html, text)
    except Exception as exc:
        logger.warning(
            "email_delivery_failed", purpose="password_reset", error_type=type(exc).__name__
        )
        return False


def reset_password(db: Session, token: str, password: str) -> None:
    row = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash_token(token))
    )
    if not row or row.used_at is not None or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired")
    user.password_hash = hash_password(password)
    row.used_at = datetime.utcnow()
    db.commit()
