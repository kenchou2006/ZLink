python3 -m pip install uv
python3 -m uv pip install -r requirements.txt

python3 -m uv manage.py migrate
python3 -m uv manage.py collectstatic --noinput