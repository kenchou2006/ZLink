from django.db import models
from django.contrib.auth.models import User
import string
import random

def generate_short_code():
    length = 6
    while True:
        code = ''.join(random.choices(string.ascii_letters + string.digits, k=length))
        if not Link.objects.filter(short_code=code).exists():
            return code

class Link(models.Model):
    original_url = models.URLField()
    short_code = models.CharField(max_length=15, unique=True, default=generate_short_code, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.short_code} -> {self.original_url}"

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    avatar_url = models.URLField(max_length=500, blank=True, null=True)

    def __str__(self):
        return f"{self.user.username}'s profile"
