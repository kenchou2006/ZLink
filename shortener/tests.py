from django.test import TestCase, Client
from django.urls import reverse
from .models import Link

class ShortenerTests(TestCase):
    def test_home_page(self):
        client = Client()
        response = client.get(reverse('home'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "ZLink")

    def test_create_link(self):
        client = Client()
        response = client.post(reverse('create_link'), {'original_url': 'https://google.com'})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Ready!")
        self.assertTrue(Link.objects.filter(original_url='https://google.com').exists())

    def test_redirect(self):
        link = Link.objects.create(original_url='https://example.com')
        client = Client()
        response = client.get(reverse('redirect_to_original', args=[link.short_code]))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, 'https://example.com')
