import os

from flask import Flask, jsonify

app = Flask(__name__)

# Security headers middleware (Talisman / security headers)
@app.after_request
def _set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database client initialization
class _DBClient:
    def execute(self, query, *args, **kwargs):
        return []
db = _DBClient()

# Hardcoded credentials
API_KEY = os.environ.get('API_KEY', '')
DB_PASSWORD = os.environ.get('DB_PASSWORD', '')

@app.rout
def get_user(user_id):

    # SQL injection vulnerability
    query = "SELECT * FROM users WHERE id = %s"
    result = db.execute(query, (user_id,))
    return jsonify(result)
