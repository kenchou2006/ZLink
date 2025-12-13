from django.contrib import admin
from .models import Link

@admin.register(Link)
class LinkAdmin(admin.ModelAdmin):
    list_display = ('short_code', 'original_url', 'created_at')
    search_fields = ('short_code', 'original_url')
    readonly_fields = ('short_code',)
