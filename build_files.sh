python3 -m pip install uv

uv pip install -r requirements.txt
uv manage.py migrate
uv manage.py collectstatic --noinput