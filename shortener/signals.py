from django.db.models.signals import post_save, post_delete,post_migrate
from django.dispatch import receiver
from django.core.cache import cache
from .models import Link
from .utils import link_cache_key
from django.contrib.auth import get_user_model
from django.conf import settings


@receiver([post_save, post_delete], sender=Link)
def clear_link_cache(sender, instance, **kwargs):
    cache.delete(link_cache_key(instance.short_code))

@receiver(post_migrate)
def create_superuser(sender, **kwargs):
    User = get_user_model()
    if not User.objects.filter(is_superuser=True).exists() and not settings.DEBUG:
        User.objects.create_superuser(
            username=settings.DEFAULT_SUPERUSER_USERNAME,
            email=settings.DEFAULT_SUPERUSER_EMAIL,
            password=settings.DEFAULT_SUPERUSER_PASSWORD
        )
        print(f"Superuser '{settings.DEFAULT_SUPERUSER_USERNAME}' created successfully.")