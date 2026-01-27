from django.shortcuts import render, redirect, get_object_or_404
from django.http import Http404, HttpResponse
from django.core.cache import cache
from django_redis import get_redis_connection
from django.contrib import messages
from django.urls import reverse
from django.contrib.auth import login, logout
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.models import User
from django.contrib.auth.decorators import user_passes_test, login_required
from django.conf import settings
from django.utils.http import url_has_allowed_host_and_scheme
from .utils import link_cache_key, get_client_ip
from .models import Link
from zlink.settings import CACHE_TTL
from .ga4 import send_ga4_event
from .forms import LinkCreateForm, LinkUpdateForm, AdminUserCreateForm, AdminUserUpdateForm, ProfileForm
from .services import (
    resolve_link as service_resolve_link,
    create_link as service_create_link,
    update_link as service_update_link,
    delete_link as service_delete_link,
    create_admin_user,
)
import time
import logging

logger = logging.getLogger(__name__)


def _errors_to_message(form):
    return "; ".join([" ".join(v) for v in form.errors.values()]) if form and form.errors else ""

def admin_required(view_func):
    return user_passes_test(
        lambda u: u.is_active and u.is_staff,
        login_url='login'
    )(view_func)

def superuser_required(view_func):
    return user_passes_test(
        lambda u: u.is_active and u.is_superuser,
        login_url='login'
    )(view_func)

def resolve_short_code(request, short_code):
    key = link_cache_key(short_code)
    try:
        cached_data = cache.get(key)
    except Exception:
        cached_data = None
        if settings.DEBUG:
            logger.warning("Cache get failed for key %s", key)

    client_ip = get_client_ip(request)
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    
    if cached_data:
        try:
            cache.touch(key, CACHE_TTL)
        except Exception:
            if settings.DEBUG:
                logger.warning("Cache touch failed for key %s", key)

        target_url = cached_data['url'] if isinstance(cached_data, dict) else cached_data
        
        # GA4 Tracking
        current_scheme = request.scheme
        current_host = request.get_host()
        full_short_url = f"{current_scheme}://{current_host}/{short_code}"
        
        send_ga4_event(
            request, 
            params={
                'page_title': target_url, # Use original URL as page title
                'page_location': full_short_url
            },
            ip_address=client_ip,
            user_agent=user_agent
        )
        
        return redirect(target_url)

    link = service_resolve_link(short_code)

    # GA4 Tracking for non-cached hit
    current_scheme = request.scheme
    current_host = request.get_host()
    full_short_url = f"{current_scheme}://{current_host}/{short_code}"
    
    send_ga4_event(
        request, 
        params={
            'page_title': link.original_url, # Use original URL as page title
            'page_location': full_short_url
        },
        ip_address=client_ip,
        user_agent=user_agent
    )

    try:
        cache.set(
            key,
            {
                "url": link.original_url,
                "id": link.id,
                "cached_at": time.time(),
            },
            timeout=CACHE_TTL
        )
    except Exception:
        if settings.DEBUG:
            logger.warning("Cache set failed for key %s", key)
    return redirect(link.original_url)

def login_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')

    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            next_url = request.POST.get('next')
            if next_url and url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):
                return redirect(next_url)
            return redirect('dashboard')
    else:
        form = AuthenticationForm()

    return render(request, 'shortener/login.html', {'form': form})


@superuser_required
def delete_cache_key(request):
    if request.method == 'POST':
        key = request.POST.get('key')
        if key:
            try:
                con = get_redis_connection("default")
                con.delete(key)
                messages.success(request, f"Key '{key}' deleted.")
            except Exception as e:
                messages.error(request, f"Error deleting key: {e}")

    return redirect('settings_cache')

@superuser_required
def clear_all_cache(request):
    if request.method == 'POST':
        try:
            con = get_redis_connection("default")
            keys = list(con.scan_iter(match="*shortener:url:*"))
            if keys:
                con.delete(*keys)
            messages.success(request, "All 'shortener:url:*' cache keys cleared.")
        except Exception as e:
            messages.error(request, f"Error clearing cache: {e}")

    # Previously returned HTMX fragment for HX-Request; now always redirect to settings page
    return redirect('settings_cache')

def root_redirect(request):
    try:
        return resolve_short_code(request, '@root')
    except Http404:
        if request.user.is_authenticated:
            return redirect('dashboard')
        return redirect('login')

@admin_required
def delete_link(request, link_id):
    if request.method == 'POST':
        link = get_object_or_404(Link, id=link_id)
        service_delete_link(link)
        messages.success(request, "Link deleted.")
        if request.headers.get('HX-Request'):
            dashboard_url = reverse('dashboard')
            return HttpResponse('', headers={'HX-Redirect': dashboard_url})
    return redirect('dashboard')


def redirect_to_original(request, short_code):
    return resolve_short_code(request, short_code)

@admin_required
def dashboard(request):
    links = Link.objects.all().order_by('-created_at')
    form = LinkCreateForm()
    hx_target = request.headers.get('HX-Target')
    if request.headers.get('HX-Request') and hx_target == 'links-table':
        return render(request, 'shortener/_links_table.html', {'links': links, 'scheme': request.scheme, 'host': request.get_host()})
    return render(request, 'shortener/links.html', {'links': links, 'section': 'links', 'form': form})


@admin_required
def create_link(request):
    if request.method != 'POST':
        return redirect('dashboard')

    form = LinkCreateForm(request.POST)
    if form.is_valid():
        original_url = form.cleaned_data['original_url']
        custom_alias = form.cleaned_data.get('custom_alias') or None
        try:
            link = service_create_link(original_url, custom_alias)
            if custom_alias:
                messages.success(request, f"Link created with alias: {custom_alias}")
            else:
                messages.success(request, f"Link created: {link.short_code}")
        except Exception as e:
            messages.error(request, f"Error creating link: {str(e)}")
    else:
        messages.error(request, _errors_to_message(form))

    links = Link.objects.all().order_by('-created_at')
    if request.headers.get('HX-Request'):
        dashboard_url = reverse('dashboard')
        return HttpResponse('', headers={'HX-Redirect': dashboard_url})
    return render(request, 'shortener/links.html', {'links': links, 'section': 'links', 'form': form})

@superuser_required
def create_user(request):
    form = AdminUserCreateForm(request.POST or None)
    if request.method == 'POST':
        if form.is_valid():
            try:
                create_admin_user(
                    username=form.cleaned_data['username'],
                    email=form.cleaned_data.get('email', ''),
                    password=form.cleaned_data['password'],
                )
                messages.success(request, f"User {form.cleaned_data['username']} created.")
                return redirect('settings_users')
            except Exception as e:
                messages.error(request, f"Error creating user: {e}")
        else:
            messages.error(request, _errors_to_message(form))

    return render(request, 'shortener/create_user.html', {'form': form})

@admin_required
def delete_user(request, user_id):
    if request.method == 'POST':
        user = get_object_or_404(User, id=user_id)

        if user == request.user:
            messages.error(request, "You cannot delete yourself.")
            return redirect('settings_users')

        if user.is_superuser or user.is_staff:
            if not request.user.is_superuser:
                messages.error(request, "Only superusers can delete staff or superuser accounts.")
                return redirect('settings_users')

        user.delete()
        messages.success(request, "User deleted.")
    return redirect('settings_users')

@superuser_required
def toggle_user_active(request, user_id):
    if request.method == 'POST':
        user = get_object_or_404(User, id=user_id)
        if user == request.user:
            messages.error(request, "You cannot deactivate yourself.")
        elif user.is_superuser:
            messages.error(request, "Superusers cannot be deactivated.")
        elif user.is_staff and not request.user.is_superuser:
            messages.error(request, "Only superusers can deactivate staff accounts.")
        else:
            user.is_active = not user.is_active
            user.save()
            status = "activated" if user.is_active else "deactivated"
            messages.success(request, f"User {user.username} has been {status}.")
    return redirect('settings_users')

def logout_view(request):
    logout(request)
    return redirect('login')

@admin_required
def edit_user(request, user_id):
    user_to_edit = get_object_or_404(User, id=user_id)
    
    if user_to_edit.is_superuser and not request.user.is_superuser:
        messages.error(request, "You do not have permission to edit this user.")
        return redirect('settings_users')

    if user_to_edit.is_staff and not request.user.is_superuser:
        messages.error(request, "Only superusers can manage staff accounts.")
        return redirect('settings_users')

    form = None
    if request.method == 'POST':
        action = request.POST.get('action')
        
        # Handle activate/deactivate actions
        if action == 'activate':
            if request.user.is_superuser and user_to_edit != request.user:
                user_to_edit.is_active = True
                user_to_edit.save()
                messages.success(request, f"User {user_to_edit.username} has been activated.")
                return redirect('edit_user', user_id=user_id)
            else:
                 messages.error(request, "Permission denied or invalid action.")
                 return redirect('edit_user', user_id=user_id)

        if action == 'deactivate':
            if request.user.is_superuser and user_to_edit != request.user:
                user_to_edit.is_active = False
                user_to_edit.save()
                messages.success(request, f"User {user_to_edit.username} has been deactivated.")
                return redirect('edit_user', user_id=user_id)
            else:
                 messages.error(request, "Permission denied or invalid action.")
                 return redirect('edit_user', user_id=user_id)

        if action == 'delete':
            if user_to_edit == request.user:
                messages.error(request, "You cannot delete yourself.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            if user_to_edit.is_superuser or user_to_edit.is_staff:
                if not request.user.is_superuser:
                    messages.error(request, "Only superusers can delete staff or superuser accounts.")
                    return redirect('settings_users')
            username = user_to_edit.username
            user_to_edit.delete()
            messages.success(request, f"User {username} deleted.")
            if request.headers.get('HX-Request'):
                settings_url = reverse('settings_users')
                return HttpResponse('', headers={'HX-Redirect': settings_url})
            return redirect('settings_users')

        form = AdminUserUpdateForm(request.POST, user_id=user_id)
        if form.is_valid():
            username = form.cleaned_data.get('username')
            email = form.cleaned_data.get('email')
            password = form.cleaned_data.get('password')
            is_superuser_flag = form.cleaned_data.get('is_superuser', user_to_edit.is_superuser)

            # Only superusers may change another user's superuser/staff privileges
            if not request.user.is_superuser and user_to_edit.is_superuser:
                messages.error(request, "Only superusers can change superuser privileges.")
                return redirect('settings_users')
            if not request.user.is_superuser and user_to_edit.is_staff:
                messages.error(request, "Only superusers can change staff privileges.")
                return redirect('settings_users')

            if username:
                user_to_edit.username = username
            if email is not None:
                user_to_edit.email = email
            if password:
                user_to_edit.set_password(password)

            if request.user.is_superuser and user_to_edit != request.user:
                user_to_edit.is_superuser = is_superuser_flag

            user_to_edit.save()
            messages.success(request, f"User {user_to_edit.username} updated successfully.")
            return redirect('settings_users')
        else:
            messages.error(request, _errors_to_message(form))

    if form is None:
        form = AdminUserUpdateForm(user_id=user_id)

    return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit, 'form': form})

@admin_required
def edit_link(request, link_id):
    link = get_object_or_404(Link, id=link_id)
    form = LinkUpdateForm(request.POST or None, link_id=link.id, initial_alias=link.short_code)

    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'delete':
            service_delete_link(link)
            messages.success(request, "Link deleted.")
            if request.headers.get('HX-Request'):
                dashboard_url = reverse('dashboard')
                return HttpResponse('', headers={'HX-Redirect': dashboard_url})
            return redirect('dashboard')
            
        if form.is_valid():
            new_short_code = form.cleaned_data.get('custom_alias') or link.short_code
            new_original_url = form.cleaned_data.get('original_url') or link.original_url
            try:
                service_update_link(link, new_original_url, new_short_code)
                messages.success(request, "Link updated successfully.")
                return redirect('dashboard')
            except Exception as e:
                messages.error(request, f"Error updating link: {e}")
        else:
            messages.error(request, _errors_to_message(form))

    return render(request, 'shortener/edit_link.html', {'link': link, 'form': form})

@admin_required
def settings_view(request):
    # Redirect to profile by default
    return redirect('settings_profile')

@login_required
def settings_profile(request):
    """
    View for user profile settings - accessible to all users
    """
    form = ProfileForm(request.POST or None, user=request.user)
    if request.method == 'POST':
        if form.is_valid():
            user = request.user
            username = form.cleaned_data.get('username') or user.username
            email = form.cleaned_data.get('email') if form.cleaned_data.get('email') is not None else user.email
            avatar_url = form.cleaned_data.get('avatar_url', '').strip()
            new_password = form.cleaned_data.get('new_password')

            user.username = username
            user.email = email

            if hasattr(user, 'profile'):
                user.profile.avatar_url = avatar_url
                user.profile.save()
            else:
                 # Should exist due to signal/script, but safe fallback
                from .models import Profile
                Profile.objects.create(user=user, avatar_url=avatar_url)

            if new_password:
                user.set_password(new_password)
                user.save()
                messages.success(request, "Profile updated successfully. Please log in again with your new password.")
                logout(request)
                return redirect('login')

            user.save()
            messages.success(request, "Profile updated successfully.")
            return redirect('settings_profile')
        else:
            messages.error(request, _errors_to_message(form))

    return render(request, 'shortener/settings_profile.html', {
        'section': 'settings',
        'form': form,
    })

@superuser_required
def settings_users(request):
    # Get users data
    users = list(User.objects.select_related('profile').exclude(id=request.user.id).order_by('-date_joined'))
    users.insert(0, request.user)

    # Calculate user stats
    active_count = sum(1 for u in users if u.is_active)
    superuser_count = sum(1 for u in users if u.is_superuser)

    return render(request, 'shortener/settings_users.html', {
        'users': users,
        'active_count': active_count,
        'superuser_count': superuser_count,
        'section': 'settings'
    })

@superuser_required
def settings_cache(request):
    # Get cache data
    cache_data = []
    error = None
    try:
        con = get_redis_connection("default")
        keys = []
        for key in con.scan_iter(match="*shortener:url:*"):
            keys.append(key)

        for k in keys:
            decoded_key = k.decode('utf-8')
            ttl = con.ttl(k)
            k_type = con.type(k).decode('utf-8')
            if 'url:' in decoded_key:
                display_key = decoded_key.split('url:')[-1]
            else:
                display_key = decoded_key

            cache_data.append({'key': decoded_key, 'display_key': display_key, 'ttl': ttl, 'type': k_type})
    except Exception as e:
        error = str(e)
        if settings.DEBUG:
            logger.warning("Redis connection failed in settings_cache: %s", e)

    return render(request, 'shortener/settings_cache.html', {
        'keys': cache_data,
        'error': error,
        'section': 'settings'
    })
