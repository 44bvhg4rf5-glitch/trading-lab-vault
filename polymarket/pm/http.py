"""Tiny stdlib HTTP helper with retries, timeouts and an on-disk cache.

No third-party packages: the whole research layer must run anywhere for free.
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from . import paths

USER_AGENT = "trading-lab-polymarket/0.1 (+research bot; contact via repo)"


class HttpError(RuntimeError):
    pass


def _cache_path(url: str) -> Path:
    return paths.cache_dir() / (hashlib.sha1(url.encode()).hexdigest() + ".json")


def get_text(url: str, *, timeout: float = 20.0, retries: int = 3, ttl: float = 0.0,
             headers: dict[str, str] | None = None) -> str:
    """GET a URL. ttl>0 caches the body on disk for that many seconds."""
    cp = _cache_path(url)
    if ttl > 0 and cp.exists():
        try:
            cached = json.loads(cp.read_text(encoding="utf-8"))
            if time.time() - cached["t"] < ttl:
                return cached["body"]
        except Exception:
            pass
    hdrs = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            if ttl > 0:
                paths.cache_dir().mkdir(parents=True, exist_ok=True)
                cp.write_text(json.dumps({"t": time.time(), "body": body}), encoding="utf-8")
            return body
        except urllib.error.HTTPError as e:  # 4xx/5xx
            last = e
            if e.code == 429 or e.code >= 500:
                time.sleep(1.5 * (2 ** attempt))
                continue
            raise HttpError(f"{e.code} for {url}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            time.sleep(1.0 * (2 ** attempt))
    raise HttpError(f"failed after {retries} attempts: {url}: {last}")


def get_json(url: str, **kw: Any) -> Any:
    return json.loads(get_text(url, **kw))


def post_json(url: str, payload: Any, *, timeout: float = 60.0) -> Any:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": USER_AGENT, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
