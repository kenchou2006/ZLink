from django.db import models
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
    short_code = models.CharField(max_length=15, unique=True, default=generate_short_code)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.short_code} -> {self.original_url}"
