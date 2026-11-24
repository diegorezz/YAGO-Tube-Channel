import logging
import shutil
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings

logger = logging.getLogger(__name__)


class StorageService:
    """
    Unified private storage adapter:
    - Uses Amazon S3 (or S3-compatible Cloudflare R2 / MinIO) + Presigned / CloudFront URLs when configured.
    - Falls back transparently to local filesystem storage for zero-config deployments.
    """

    def __init__(self):
        self.settings = get_settings()
        self._s3_client = None
        if self.is_s3_enabled:
            client_kwargs = {
                "region_name": self.settings.s3_region,
            }
            if self.settings.s3_endpoint_url:
                client_kwargs["endpoint_url"] = self.settings.s3_endpoint_url
            if self.settings.aws_access_key_id and self.settings.aws_secret_access_key:
                client_kwargs["aws_access_key_id"] = self.settings.aws_access_key_id
                client_kwargs["aws_secret_access_key"] = self.settings.aws_secret_access_key
            self._s3_client = boto3.client("s3", **client_kwargs)

    @property
    def is_s3_enabled(self) -> bool:
        return bool(self.settings.s3_bucket.strip())

    def upload_file(self, local_path: str, key: str, content_type: str = "video/mp4") -> str:
        """Store file privately in S3 or local storage and return an accessible URL."""
        normalized_key = key.lstrip("/")
        if self.is_s3_enabled and self._s3_client is not None:
            self._s3_client.upload_file(
                local_path,
                self.settings.s3_bucket,
                normalized_key,
                ExtraArgs={"ACL": "private", "ContentType": content_type},
            )
            return self.get_download_url(normalized_key)

        dest = self.settings.storage_path / "media" / normalized_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, dest)
        base = self.settings.public_base_url.rstrip("/")
        return f"{base}/api/media/{normalized_key}" if base else f"/api/media/{normalized_key}"

    def get_download_url(self, key: str, expires_in: Optional[int] = None) -> str:
        """Generate a signed S3 URL, CloudFront CDN URL, or local media endpoint URL."""
        normalized_key = key.lstrip("/")
        ttl = expires_in or self.settings.signed_url_ttl_seconds

        if self.is_s3_enabled and self._s3_client is not None:
            if self.settings.cloudfront_domain:
                domain = self.settings.cloudfront_domain.rstrip("/")
                return f"https://{domain}/{normalized_key}"
            return self._s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.settings.s3_bucket, "Key": normalized_key},
                ExpiresIn=ttl,
            )

        base = self.settings.public_base_url.rstrip("/")
        return f"{base}/api/media/{normalized_key}" if base else f"/api/media/{normalized_key}"

    def resolve_local_path(self, key: str) -> Optional[Path]:
        """Return local filesystem path for a stored object (downloads from S3 to tmp if needed)."""
        normalized_key = key.lstrip("/")
        if not self.is_s3_enabled:
            path = (self.settings.storage_path / "media" / normalized_key).resolve()
            media_root = (self.settings.storage_path / "media").resolve()
            if not str(path).startswith(str(media_root)) or not path.exists():
                return None
            return path

        if self._s3_client is not None:
            cached = self.settings.tmp_path / "s3_cache" / normalized_key
            cached.parent.mkdir(parents=True, exist_ok=True)
            if not cached.exists():
                try:
                    self._s3_client.download_file(self.settings.s3_bucket, normalized_key, str(cached))
                except (BotoCoreError, ClientError) as exc:
                    logger.error("Failed to fetch S3 object %s: %s", normalized_key, exc)
                    return None
            return cached
        return None

    def delete_object(self, key: str) -> None:
        normalized_key = key.lstrip("/")
        if self.is_s3_enabled and self._s3_client is not None:
            try:
                self._s3_client.delete_object(Bucket=self.settings.s3_bucket, Key=normalized_key)
            except (BotoCoreError, ClientError) as exc:
                logger.warning("Failed deleting S3 object %s: %s", normalized_key, exc)
            return

        path = self.settings.storage_path / "media" / normalized_key
        if path.exists():
            path.unlink(missing_ok=True)
