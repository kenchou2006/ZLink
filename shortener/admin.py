from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User
from .models import Link, Profile

@admin.register(Link)
class LinkAdmin(admin.ModelAdmin):
    list_display = ('short_code', 'original_url', 'created_at')
    search_fields = ('short_code', 'original_url')
    readonly_fields = ('short_code',)

class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    verbose_name_plural = 'Profile'

class UserAdmin(BaseUserAdmin):
    inlines = (ProfileInline,)
    list_display = ('username', 'email', 'first_name', 'last_name', 'is_staff', 'get_avatar_url')
    
    def get_avatar_url(self, obj):
        return obj.profile.avatar_url
    get_avatar_url.short_description = 'Avatar URL'

admin.site.unregister(User)
admin.site.register(User, UserAdmin)
