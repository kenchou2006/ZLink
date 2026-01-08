from django import forms
from django.contrib.auth.models import User
from .utils import validate_short_code, normalize_short_code


class LinkCreateForm(forms.Form):
    original_url = forms.URLField()
    custom_alias = forms.CharField(required=False, max_length=15)

    def clean_custom_alias(self):
        alias = self.cleaned_data.get('custom_alias', '').strip()
        if not alias:
            return ''
        error = validate_short_code(alias)
        if error:
            raise forms.ValidationError(error)
        return normalize_short_code(alias)


class LinkUpdateForm(forms.Form):
    original_url = forms.URLField(required=False)
    custom_alias = forms.CharField(required=False, max_length=15)

    def __init__(self, *args, **kwargs):
        self.link_id = kwargs.pop('link_id', None)
        self.initial_alias = kwargs.pop('initial_alias', None)
        super().__init__(*args, **kwargs)

    def clean_custom_alias(self):
        alias = self.cleaned_data.get('custom_alias', '').strip()
        if not alias:
            return ''
        if self.initial_alias and alias == self.initial_alias:
            return normalize_short_code(alias)
        error = validate_short_code(alias, exclude_link_id=self.link_id)
        if error:
            raise forms.ValidationError(error)
        return normalize_short_code(alias)


class AdminUserCreateForm(forms.Form):
    username = forms.CharField(max_length=150)
    email = forms.EmailField(required=False)
    password = forms.CharField(widget=forms.PasswordInput)
    confirm_password = forms.CharField(widget=forms.PasswordInput)

    def clean_username(self):
        username = self.cleaned_data['username']
        if User.objects.filter(username=username).exists():
            raise forms.ValidationError("Username already exists.")
        return username

    def clean_email(self):
        email = self.cleaned_data.get('email', '').strip()
        if email and User.objects.filter(email=email).exists():
            raise forms.ValidationError("Email already exists.")
        return email

    def clean(self):
        cleaned = super().clean()
        pwd = cleaned.get('password')
        confirm = cleaned.get('confirm_password')
        if pwd and confirm and pwd != confirm:
            self.add_error('confirm_password', "Passwords do not match.")
        return cleaned


class AdminUserUpdateForm(forms.Form):
    username = forms.CharField(max_length=150, required=False)
    email = forms.EmailField(required=False)
    password = forms.CharField(widget=forms.PasswordInput, required=False)
    confirm_password = forms.CharField(widget=forms.PasswordInput, required=False)
    is_superuser = forms.BooleanField(required=False)

    def __init__(self, *args, **kwargs):
        self.user_id = kwargs.pop('user_id', None)
        super().__init__(*args, **kwargs)

    def clean_username(self):
        username = self.cleaned_data.get('username')
        if username and User.objects.filter(username=username).exclude(id=self.user_id).exists():
            raise forms.ValidationError("Username already exists.")
        return username

    def clean_email(self):
        email = self.cleaned_data.get('email', '').strip()
        if email and User.objects.filter(email=email).exclude(id=self.user_id).exists():
            raise forms.ValidationError("Email already exists.")
        return email

    def clean(self):
        cleaned = super().clean()
        pwd = cleaned.get('password')
        confirm = cleaned.get('confirm_password')
        if pwd or confirm:
            if not pwd or not confirm or pwd != confirm:
                self.add_error('confirm_password', "Passwords do not match.")
        return cleaned


class ProfileForm(forms.Form):
    username = forms.CharField(max_length=150, required=False)
    email = forms.EmailField(required=False)
    avatar_url = forms.URLField(required=False)
    current_password = forms.CharField(widget=forms.PasswordInput, required=False)
    new_password = forms.CharField(widget=forms.PasswordInput, required=False)
    confirm_password = forms.CharField(widget=forms.PasswordInput, required=False)

    def __init__(self, *args, **kwargs):
        self.user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)

    def clean_username(self):
        username = self.cleaned_data.get('username')
        if username and self.user and username != self.user.username:
            if User.objects.filter(username=username).exclude(id=self.user.id).exists():
                raise forms.ValidationError("Username already exists.")
        return username

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip()
        if email and self.user and email != self.user.email:
            if User.objects.filter(email=email).exclude(id=self.user.id).exists():
                raise forms.ValidationError("Email already exists.")
        return email

    def clean(self):
        cleaned = super().clean()
        new_pwd = cleaned.get('new_password')
        confirm = cleaned.get('confirm_password')
        current = cleaned.get('current_password')
        if new_pwd or confirm:
            if not new_pwd or not confirm or new_pwd != confirm:
                self.add_error('confirm_password', "New passwords do not match.")
            if self.user and not current:
                self.add_error('current_password', "Current password is required to change password.")
            elif self.user and current and not self.user.check_password(current):
                self.add_error('current_password', "Current password is incorrect.")
        return cleaned
