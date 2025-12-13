from django.shortcuts import render, redirect, get_object_or_404
from django.urls import resolve, Resolver404
from django.http import Http404
from django.core.cache import cache
from django_redis import get_redis_connection
from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.models import User
from django.contrib.auth.decorators import user_passes_test
from django.utils.http import url_has_allowed_host_and_scheme
from .utils import link_cache_key
from .models import Link
from zlink.settings import CACHE_TTL
import time

def admin_required(view_func):
    return user_passes_test(
        lambda u: u.is_active and u.is_staff,
        login_url='login'
    )(view_func)

def resolve_short_code(request, short_code):
    key = link_cache_key(short_code)
    try:
        cached_data = cache.get(key)
    except Exception:
        cached_data = None
        
    if cached_data:
        try:
            cache.touch(key, CACHE_TTL)
        except Exception:
            pass
            
        if isinstance(cached_data, dict):
             return redirect(cached_data['url'])
        return redirect(cached_data)

    link = get_object_or_404(Link, short_code=short_code)
    
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
def cache_overview(request):
    if not request.user.is_superuser:
        messages.error(request, "Access denied.")
        return redirect('dashboard')
    
    try:
        con = get_redis_connection("default")
        keys = []
        for key in con.scan_iter(match="*shortener:url:*"):
            keys.append(key)

        cache_data = []
        for k in keys:
            decoded_key = k.decode('utf-8')
            ttl = con.ttl(k)
            k_type = con.type(k).decode('utf-8')
            if 'url:' in decoded_key:
                 display_key = decoded_key.split('url:')[-1]
            else:
                 display_key = decoded_key
            
            cache_data.append({'key': decoded_key, 'display_key': display_key, 'ttl': ttl, 'type': k_type})
        
        return render(request, 'shortener/cache.html', {'keys': cache_data, 'section': 'cache'})
    except Exception as e:
        messages.error(request, f"Redis error or not connected: {e}")
        return render(request, 'shortener/cache.html', {'keys': [], 'error': str(e), 'section': 'cache'})

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
    return redirect('cache_overview')

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
    return redirect('cache_overview')

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
    return render(request, 'shortener/dashboard.html', {'links': links, 'section': 'links'})


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
                    reserved_aliases = ['links', 'login', 'create', 'delete', 'users', 'logout', 'admin', 'static', 'cache']
                    if custom_alias.lower() in reserved_aliases:
                        messages.error(request, f"Alias '{custom_alias}' is reserved and cannot be used.")
                        return redirect('dashboard')

                    if custom_alias.lower().startswith('users/') or custom_alias.lower().startswith('delete/') or custom_alias.lower().startswith('cache/'):
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
def user_list(request):
    users = list(User.objects.exclude(id=request.user.id).order_by('-date_joined'))
    users.insert(0, request.user)
    return render(request, 'shortener/users.html', {'users': users, 'section': 'users'})

@admin_required
def create_user(request):
    if not request.user.is_superuser:
        messages.error(request, "Only superusers can create new admin accounts.")
        return redirect('user_list')

    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')

        if username and password:
            if User.objects.filter(username=username).exists():
                messages.error(request, "Username already exists.")
                return render(request, 'shortener/create_user.html')

            if password != confirm_password:
                messages.error(request, "Passwords do not match.")
                return render(request, 'shortener/create_user.html')

            user = User.objects.create_user(username=username, password=password)
            user.is_staff = True 
            user.save()
            messages.success(request, f"User {username} created.")
            return redirect('user_list')

    return render(request, 'shortener/create_user.html')

@admin_required
def delete_user(request, user_id):
    if request.method == 'POST':
        user = get_object_or_404(User, id=user_id)

        if user.is_superuser and not request.user.is_superuser:
            messages.error(request, "You do not have permission to delete superusers.")
            return redirect('user_list')

        if user == request.user:
            messages.error(request, "You cannot delete yourself.")
        else:
            user.delete()
            messages.success(request, "User deleted.")
    return redirect('user_list')

@admin_required
def toggle_user_active(request, user_id):
    if request.method == 'POST':
        if not request.user.is_superuser:
             messages.error(request, "Only superusers can change user status.")
             return redirect('user_list')

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
    return redirect('user_list')

def logout_view(request):
    logout(request)
    return redirect('login')

@admin_required
def edit_user(request, user_id):
    user_to_edit = get_object_or_404(User, id=user_id)
    
    if user_to_edit.is_superuser and not request.user.is_superuser:
        messages.error(request, "You do not have permission to edit this user.")
        return redirect('user_list')
    
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')
        
        if username:
            if User.objects.filter(username=username).exclude(id=user_id).exists():
                messages.error(request, "Username already exists.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            
            user_to_edit.username = username
            
        if password and password.strip():
            if password != confirm_password:
                messages.error(request, "Passwords do not match.")
                return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})
            user_to_edit.set_password(password)
            
        if request.user.is_superuser and user_to_edit != request.user:
            is_superuser = request.POST.get('is_superuser') == 'on'
            user_to_edit.is_superuser = is_superuser
            
        user_to_edit.save()
        messages.success(request, f"User {user_to_edit.username} updated successfully.")
        return redirect('user_list')
        
    return render(request, 'shortener/edit_user.html', {'target_user': user_to_edit})