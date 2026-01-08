import os
import requests
import threading
import uuid
import urllib.parse
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

GA_MEASUREMENT_ID = os.environ.get('GA_MEASUREMENT_ID') or getattr(settings, 'GA_MEASUREMENT_ID', None)
GA_API_SECRET = os.environ.get('GA_API_SECRET') or getattr(settings, 'GA_API_SECRET', None)
GA_TIMEOUT = getattr(settings, 'GA4_TIMEOUT', 3)
GA_ASYNC = getattr(settings, 'GA4_ASYNC', True)

logger.info("GA4 config: enabled=%s timeout=%s async=%s", bool(GA_MEASUREMENT_ID and GA_API_SECRET), GA_TIMEOUT, GA_ASYNC)


def _send_ga4_event_thread(client_id, event_name, params, ip_address=None, user_agent=None, user_data=None):
    if not GA_MEASUREMENT_ID or not GA_API_SECRET:
        return

    url = f"https://www.google-analytics.com/mp/collect?measurement_id={GA_MEASUREMENT_ID}&api_secret={GA_API_SECRET}"
    
    if ip_address:
         url += f"&ip_override={ip_address}"

    if user_agent:
        encoded_ua = urllib.parse.quote(user_agent)
        url += f"&ua={encoded_ua}"

    payload = {
        "client_id": client_id,
        "events": [{
            "name": event_name,
            "params": params
        }]
    }

    if user_data:
        payload["user_data"] = user_data

    if settings.DEBUG:
        logger.debug("GA4 sending event=%s payload=%s ip=%s ua=%s", event_name, payload, ip_address, user_agent)

    try:
        headers = {}
        if user_agent:
            headers['User-Agent'] = user_agent

        response = requests.post(url, json=payload, headers=headers, timeout=GA_TIMEOUT)
        if settings.DEBUG:
            logger.debug("GA4 response %s %s", response.status_code, response.text[:200])
    except requests.Timeout as e:
        log_fn = logger.debug if not settings.DEBUG else logger.warning
        log_fn("GA4 send timeout: %s", e)
    except requests.RequestException as e:
        log_fn = logger.debug if not settings.DEBUG else logger.warning
        log_fn("GA4 request failed: %s", e)
    except Exception as e:
        logger.debug("GA4 unexpected error: %s", e, exc_info=settings.DEBUG)


def send_ga4_event(request, event_name='page_view', params=None, ip_address=None, user_agent=None, user_data=None):
    if not GA_MEASUREMENT_ID or not GA_API_SECRET:
        return

    if params is None:
        params = {}

    client_id = request.COOKIES.get('_ga', str(uuid.uuid4()))
    if client_id.startswith('GA'):
        parts = client_id.split('.')
        if len(parts) > 2:
            client_id = '.'.join(parts[2:])

    def _send():
        _send_ga4_event_thread(client_id, event_name, params, ip_address, user_agent, user_data)

    if GA_ASYNC:
        try:
            thread = threading.Thread(target=_send, daemon=True)
            thread.start()
        except Exception as exc:
            logger.debug("GA4 async dispatch failed, retrying sync: %s", exc)
            _send()
    else:
        _send()
