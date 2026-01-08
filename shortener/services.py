from django.core.cache import cache
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from django.db import transaction
from .models import Link
from .utils import link_cache_key
from zlink.settings import CACHE_TTL
import logging

logger = logging.getLogger(__name__)


def resolve_link(short_code: str) -> Link:
    return get_object_or_404(Link, short_code=short_code)


def cache_link(link: Link):
    try:
        cache.set(
            link_cache_key(link.short_code),
            {
                "url": link.original_url,
                "id": link.id,
            },
            timeout=CACHE_TTL
        )
    except Exception:
        logger.debug("Cache set failed for %s", link.short_code)


def invalidate_link_cache(short_code: str):
    try:
        cache.delete(link_cache_key(short_code))
    except Exception:
        logger.debug("Cache delete failed for %s", short_code)


def create_link(original_url: str, custom_alias: str | None = None) -> Link:
    if custom_alias:
        link = Link.objects.create(original_url=original_url, short_code=custom_alias)
    else:
        link = Link.objects.create(original_url=original_url)
    return link


def update_link(link: Link, original_url: str | None, new_short_code: str | None):
    old_code = link.short_code
    if original_url:
        link.original_url = original_url
    if new_short_code and new_short_code != link.short_code:
        link.short_code = new_short_code
    with transaction.atomic():
        link.save()
        invalidate_link_cache(old_code)
        if old_code != link.short_code:
            invalidate_link_cache(link.short_code)
    return link


def delete_link(link: Link):
    invalidate_link_cache(link.short_code)
    link.delete()


def create_admin_user(username: str, email: str, password: str) -> User:
    user = User.objects.create_user(username=username, email=email, password=password)
    user.is_staff = True
    user.save()
    return user
