from django.shortcuts import render, redirect, get_object_or_404
from django.urls import resolve, Resolver404
from django.http import Http404
from django.core.cache import cache
from django_redis import get_redis_connection
from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.models import User
from django.contrib.auth.decorators import user_passes_test, login_required
from django.utils.http import url_has_allowed_host_and_scheme
from .utils import link_cache_key
from .models import Link
from zlink.settings import CACHE_TTL
from .ga4 import send_ga4_event
import time

def admin_required(view_func):
    return user_passes_test(
        lambda u: u.is_active and u.is_staff,
        login_url='login'
    )(view_func)

def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

def resolve_short_code(request, short_code):
    key = link_cache_key(short_code)
    try:
        cached_data = cache.get(key)
    except Exception:
        cached_data = None
        
    client_ip = get_client_ip(request)
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    
    if cached_data:
        try:
            cache.touch(key, CACHE_TTL)
        except Exception:
            pass
            
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

    link = get_object_or_404(Link, short_code=short_code)
    
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
        pass
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


@admin_required
def delete_cache_key(request):
    if not request.user.is_superuser:
         return redirect('dashboard')
         
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

@admin_required
def clear_all_cache(request):
    if not request.user.is_superuser:
         return redirect('dashboard')

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
        link.delete()
        messages.success(request, "Link deleted.")
    return redirect('dashboard')


def redirect_to_original(request, short_code):
    return resolve_short_code(request, short_code)

@admin_required
def dashboard(request):
    links = Link.objects.all().order_by('-created_at')
    return render(request, 'shortener/links.html', {'links': links, 'section': 'links'})


@admin_required
def create_link(request):
    if request.method == 'POST':
        original_url = request.POST.get('original_url')
        custom_alias = request.POST.get('custom_alias', '').strip()

        if original_url:
            try:
                if custom_alias:
                    if custom_alias == '/' or custom_alias == '@root':
                        custom_alias = '@root'
                    reserved_aliases = ['links', 'login', 'create', 'delete', 'settings', 'logout', 'admin', 'static', 'cache']
                    if custom_alias.lower() in reserved_aliases:
                        messages.error(request, f"Alias '{custom_alias}' is reserved and cannot be used.")
                        return redirect('dashboard')

                    if custom_alias.lower().startswith('settings/') or custom_alias.lower().startswith('delete/'):
                         messages.error(request, f"Alias '{custom_alias}' is reserved and cannot be used.")
                         return redirect('dashboard')

                    if custom_alias != '@root':
                        try:
                            resolved_match = resolve(f"/{custom_alias}/")
                            if resolved_match.url_name != 'redirect_to_original':
                                messages.error(request, f"Alias '{custom_alias}' conflicts with a system URL.")
                                return redirect('dashboard')
                        except Resolver404:
                            pass

                    if Link.objects.filter(short_code=custom_alias).exists():
                        messages.error(request, f"Alias '{custom_alias}' is already taken.")
                        return redirect('dashboard')
                    Link.objects.create(original_url=original_url, short_code=custom_alias)
                    messages.success(request, f"Link created with alias: {custom_alias}")
                else:
                    link = Link.objects.create(original_url=original_url)
                    messages.success(request, f"Link created: {link.short_code}")
            except Exception as e:
                messages.error(request, f"Error creating link: {str(e)}")

    return redirect('dashboard')


@admin_required
def create_user(request):
    if not request.user.is_superuser:
        messages.error(request, "Only superusers can create new admin accounts.")
        return redirect('settings_users')

    if request.method == 'POST':
        username = request.POST.get('username')
        email = request.POST.get('email', '').strip()
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')

        if username and password:
            if User.objects.filter(username=username).exists():
                messages.error(request, "Username already exists.")
                return render(request, 'shortener/create_user.html')

            if email and User.objects.filter(email=email).exists():
                messages.error(request, "Email already exists.")
                return render(request, 'shortener/create_user.html')

            if password != confirm_password:
                messages.error(request, "Passwords do not match.")
                return render(request, 'shortener/create_user.html')

            user = User.objects.create_user(username=username, email=email, password=password)
            user.is_staff = True
            user.save()
            messages.success(request, f"User {username} created.")
            return redirect('settings_users')

    return render(request, 'shortener/create_user.html')

@admin_required
def delete_user(request, user_id):
    if request.method == 'POST':
        user = get_object_or_404(User, id=user_id)

        if user.is_superuser and not request.user.is_superuser:
            messages.error(request, "You do not have permission to delete superusers.")
            return redirect('settings_users')

        if user == request.user:
            messages.error(request, "You cannot delete yourself.")
        else:
            user.delete()
            messages.success(request, "User deleted.")
    return redirect('settings_users')

@admin_required
def toggle_user_active(request, user_id):
    if request.method == 'POST':
        if not request.user.is_superuser:
             messages.error(request, "Only superusers can change user status.")
             return redirect('settings_users')

        user = get_object_or_404(User, id=user_id)
        if user == request.user:
            messages.error(request, "You cannot deactivate yourself.")
        elif user.is_superuser:
            messages.error(request, "Superusers cannot be deactivated.")
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
            if not request.user.is_superuser:
                 messages.error(request, "Permission denied.")
                 return redirect('settings_users')
            if user_to_edit.is_superuser and not request.user.is_superuser: # Redundant check but ok
                messages.error(request, "You do not have permission to delete superusers.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            
            username = user_to_edit.username
            user_to_edit.delete()
            messages.success(request, f"User {username} deleted.")
            return redirect('settings_users')

        # Handle update action (default)
        username = request.POST.get('username')
        email = request.POST.get('email', '').strip()
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')
        
        if username:
            if User.objects.filter(username=username).exclude(id=user_id).exists():
                messages.error(request, "Username already exists.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            
            user_to_edit.username = username

        # Update email
        if email != user_to_edit.email:
            if email and User.objects.filter(email=email).exclude(id=user_id).exists():
                messages.error(request, "Email already exists.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            user_to_edit.email = email

        if password and password.strip():
            if password != confirm_password:
                messages.error(request, "Passwords do not match.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            user_to_edit.set_password(password)
            
        # Security: Prevent self-deprivilege and unauthorized promotion
        if request.user.is_superuser and user_to_edit != request.user:
            # Checkbox logic: 'is_superuser' in POST means checked (True), otherwise unchecked (False)
            is_superuser = 'is_superuser' in request.POST
            user_to_edit.is_superuser = is_superuser
            
        user_to_edit.save()
        messages.success(request, f"User {user_to_edit.username} updated successfully.")
        return redirect('settings_users')

    return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})

@admin_required
def edit_link(request, link_id):
    link = get_object_or_404(Link, id=link_id)
    
    if request.method == 'POST':
        action = request.POST.get('action')
        original_short_code = link.short_code # Capture old code for cache deletion
        
        if action == 'delete':
            # Delete cache for the link being deleted
            try:
                cache_key = link_cache_key(original_short_code)
                cache.delete(cache_key)
            except Exception:
                pass
                
            link.delete()
            messages.success(request, "Link deleted.")
            return redirect('dashboard')
            
        new_short_code = request.POST.get('custom_alias', '').strip()
        new_original_url = request.POST.get('original_url', '').strip()

        if new_original_url:
            link.original_url = new_original_url

        if new_short_code and new_short_code != link.short_code:
            # Validation logic (similar to create_link)
            if new_short_code == '/' or new_short_code == '@root':
                new_short_code = '@root'
            
            reserved_aliases = ['links', 'login', 'create', 'delete', 'users', 'logout', 'admin', 'static', 'cache']
            if new_short_code.lower() in reserved_aliases:
                messages.error(request, f"Alias '{new_short_code}' is reserved.")
                return render(request, 'shortener/edit_link.html', {'link': link})

            if new_short_code.lower().startswith('users/') or new_short_code.lower().startswith('delete/') or new_short_code.lower().startswith('cache/') or new_short_code.lower().startswith('links/'):
                 messages.error(request, f"Alias '{new_short_code}' is reserved.")
                 return render(request, 'shortener/edit_link.html', {'link': link})

            if new_short_code != '@root':
                try:
                    resolved_match = resolve(f"/{new_short_code}/")
                    if resolved_match.url_name != 'redirect_to_original':
                         # If it resolves to something other than the redirect view, it's a conflict
                         messages.error(request, f"Alias '{new_short_code}' conflicts with a system URL.")
                         return render(request, 'shortener/edit_link.html', {'link': link})
                except Resolver404:
                    pass

            if Link.objects.filter(short_code=new_short_code).exclude(id=link.id).exists():
                messages.error(request, f"Alias '{new_short_code}' is already taken.")
                return render(request, 'shortener/edit_link.html', {'link': link})
            
            link.short_code = new_short_code

        try:
            link.save()
            
            # Invalidate cache for the OLD short code (if changed) or even if same (in case URL changed)
            try:
                cache_key = link_cache_key(original_short_code)
                cache.delete(cache_key)
                # If short code changed, ensure the new one is also clear (improbable but safe)
                if original_short_code != link.short_code:
                     cache.delete(link_cache_key(link.short_code))
            except Exception:
                pass
                
            messages.success(request, "Link updated successfully.")
            return redirect('dashboard')
        except Exception as e:
            messages.error(request, f"Error updating link: {e}")

    return render(request, 'shortener/edit_link.html', {'link': link})

@admin_required
def settings_view(request):
    # Redirect to profile by default
    return redirect('settings_profile')

@login_required
def settings_profile(request):
    """
    View for user profile settings - accessible to all users
    """
    if request.method == 'POST':
        username = request.POST.get('username')
        email = request.POST.get('email', '').strip()
        current_password = request.POST.get('current_password', '').strip()
        new_password = request.POST.get('new_password', '').strip()
        confirm_password = request.POST.get('confirm_password', '').strip()

        user = request.user

        # Update username
        if username and username != user.username:
            if User.objects.filter(username=username).exclude(id=user.id).exists():
                messages.error(request, "Username already exists.")
                return render(request, 'shortener/settings_profile.html')
            user.username = username

        # Update email
        if email != user.email:
            if email and User.objects.filter(email=email).exclude(id=user.id).exists():
                messages.error(request, "Email already exists.")
                return render(request, 'shortener/settings_profile.html')
            user.email = email

        # Update avatar URL
        avatar_url = request.POST.get('avatar_url', '').strip()
        if hasattr(user, 'profile'):
            user.profile.avatar_url = avatar_url
            user.profile.save()
        else:
             # Should exist due to signal/script, but safe fallback
            from .models import Profile
            Profile.objects.create(user=user, avatar_url=avatar_url)

        # Update password if provided
        if new_password:
            if not current_password:
                messages.error(request, "Current password is required to change password.")
                return render(request, 'shortener/settings_profile.html')

            if not user.check_password(current_password):
                messages.error(request, "Current password is incorrect.")
                return render(request, 'shortener/settings_profile.html')

            if new_password != confirm_password:
                messages.error(request, "New passwords do not match.")
                return render(request, 'shortener/settings_profile.html')

            user.set_password(new_password)
            messages.success(request, "Profile updated successfully. Please log in again with your new password.")
            user.save()
            logout(request)
            return redirect('login')

        user.save()
        messages.success(request, "Profile updated successfully.")
        return redirect('settings_profile')

    return render(request, 'shortener/settings_profile.html', {
        'section': 'settings'
    })

@admin_required
def settings_users(request):
    if not request.user.is_superuser:
        messages.error(request, "Access denied.")
        return redirect('dashboard')

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

@admin_required
def settings_cache(request):
    if not request.user.is_superuser:
        messages.error(request, "Access denied.")
        return redirect('dashboard')

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

    return render(request, 'shortener/settings_cache.html', {
        'keys': cache_data,
        'error': error,
        'section': 'settings'
    })
