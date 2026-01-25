from django.urls import resolve, Resolver404
from .models import Link

RESERVED_ALIASES = {
    'links', 'login', 'logout', 'create', 'delete', 'settings', 'admin', 'static', 'cache', 'users'
}
RESERVED_PREFIXES = (
    'settings/', 'delete/', 'users/', 'cache/', 'links/',
)


def normalize_short_code(short_code: str) -> str:
    """Normalize special aliases like root."""
    if short_code in {'/', '@root'}:
        return '@root'
    return short_code


def validate_short_code(short_code: str, exclude_link_id=None) -> str | None:
    """Return error message if short code is invalid; None if ok."""
    if not short_code:
        return "Alias is required."

    normalized = normalize_short_code(short_code)

    if normalized.lower() in RESERVED_ALIASES:
        return f"Alias '{normalized}' is reserved and cannot be used."

    for prefix in RESERVED_PREFIXES:
        if normalized.lower().startswith(prefix):
            return f"Alias '{normalized}' is reserved and cannot be used."

    if normalized != '@root':
        try:
            resolved_match = resolve(f"/{normalized}/")
            if resolved_match.url_name != 'redirect_to_original':
                return f"Alias '{normalized}' conflicts with a system URL."
        except Resolver404:
            pass

    qs = Link.objects.filter(short_code=normalized)
    if exclude_link_id:
        qs = qs.exclude(id=exclude_link_id)
    if qs.exists():
        return f"Alias '{normalized}' is already taken."

    return None


def link_cache_key(short_code):
    return f"shortener:url:{short_code}"

def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0]
    return request.META.get('REMOTE_ADDR')
