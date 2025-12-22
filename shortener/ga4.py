import os
import requests
import threading
import uuid
import urllib.parse
from django.conf import settings

GA_MEASUREMENT_ID = os.environ.get('GA_MEASUREMENT_ID')
GA_API_SECRET = os.environ.get('GA_API_SECRET')

def _send_ga4_event_thread(client_id, event_name, params, ip_address=None, user_agent=None, user_data=None):
    if not GA_MEASUREMENT_ID or not GA_API_SECRET:
        if settings.DEBUG:
            print(f"GA4 DEBUG: Missing credentials. MEASUREMENT_ID={GA_MEASUREMENT_ID}, API_SECRET={'Present' if GA_API_SECRET else 'Missing'}")
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
        print(f"GA4 DEBUG: Sending event: {event_name}")
        print(f"GA4 DEBUG: Payload: {payload}")
        if ip_address:
            print(f"GA4 DEBUG: IP Override: {ip_address}")
        if user_agent:
            print(f"GA4 DEBUG: User Agent: {user_agent}")
        if user_data:
            print(f"GA4 DEBUG: User Data: {user_data}")

    try:
        headers = {}
        if user_agent:
            headers['User-Agent'] = user_agent
            
        response = requests.post(url, json=payload, headers=headers, timeout=5)
        if settings.DEBUG:
            print(f"GA4 DEBUG: Response: {response.status_code} - {response.text}")
    except Exception as e:
        if settings.DEBUG:
            print(f"GA4 DEBUG: Exception: {e}")


def send_ga4_event(request, event_name='page_view', params=None, ip_address=None, user_agent=None, user_data=None):
    """
    Sends an event to GA4 asynchronously.
    """
    if not GA_MEASUREMENT_ID or not GA_API_SECRET:
        return

    if params is None:
        params = {}

    client_id = request.COOKIES.get('_ga', str(uuid.uuid4()))
    if client_id.startswith('GA'):
        parts = client_id.split('.')
        if len(parts) > 2:
             client_id = '.'.join(parts[2:])

    thread = threading.Thread(
        target=_send_ga4_event_thread,
        args=(client_id, event_name, params, ip_address, user_agent, user_data)
    )
    thread.daemon = True
    thread.start()