from django.urls import path
from . import views

urlpatterns = [
    path('', views.root_redirect, name='root_redirect'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('links/', views.dashboard, name='dashboard'),
    path('create/', views.create_link, name='create_link'),
    path('delete/<int:link_id>/', views.delete_link, name='delete_link'),
    path('users/', views.user_list, name='user_list'),
    path('users/create/', views.create_user, name='create_user'),
    path('users/delete/<int:user_id>/', views.delete_user, name='delete_user'),
    path('users/toggle/<int:user_id>/', views.toggle_user_active, name='toggle_user_active'),
    path('users/edit/<int:user_id>/', views.edit_user, name='edit_user'),
    path('cache/', views.cache_overview, name='cache_overview'),
    path('cache/delete/', views.delete_cache_key, name='delete_cache_key'),
    path('cache/clear/', views.clear_all_cache, name='clear_all_cache'),
    path('<str:short_code>/', views.redirect_to_original, name='redirect_to_original'),
]
