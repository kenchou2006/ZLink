from django.urls import path
from . import views

urlpatterns = [
    path('', views.root_redirect, name='root_redirect'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('links/', views.dashboard, name='dashboard'),
    path('links/create/', views.create_link, name='create_link'),
    path('links/edit/<int:link_id>/', views.edit_link, name='edit_link'),
    path('links/delete/<int:link_id>/', views.delete_link, name='delete_link'),
    path('settings/', views.settings_view, name='settings'),
    path('settings/profile/', views.settings_profile, name='settings_profile'),
    path('settings/users/', views.settings_users, name='settings_users'),
    path('settings/cache/', views.settings_cache, name='settings_cache'),
    path('settings/users/create/', views.create_user, name='create_user'),
    path('settings/users/<int:user_id>/edit/', views.edit_user, name='edit_user'),
    path('settings/users/<int:user_id>/delete/', views.delete_user, name='delete_user'),
    path('settings/users/<int:user_id>/toggle/', views.toggle_user_active, name='toggle_user_active'),
    path('settings/cache/delete/', views.delete_cache_key, name='delete_cache_key'),
    path('settings/cache/clear/', views.clear_all_cache, name='clear_all_cache'),
    path('<str:short_code>/', views.redirect_to_original, name='redirect_to_original'),
]