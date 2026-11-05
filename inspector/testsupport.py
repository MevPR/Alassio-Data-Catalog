"""Shared set-up of the inspector's offline tests (v1.73, F-I6) — the one place that replaces the copies of the
fake flask/requests stanza the test scripts used to carry.

The tests run as plain scripts (`python3 inspector/test_x.py`, no pytest): the script's directory is on sys.path,
so `connectors` and `app` import directly. Each script is a `unittest` module ending in `testsupport.main()`, so
every failing check is reported (not just the first) and the exit status is non-zero on failure.
"""
import importlib
import importlib.util
import sys
import types
import unittest


def have(module):
    """True when `module` is installed (duckdb, flask — optional on CI and developer machines)."""
    return importlib.util.find_spec(module) is not None


class _FakeFlask:
    """Just enough of flask.Flask for `import app` to succeed: route decorators that return the view unchanged."""
    def __init__(self, *_a, **_k):
        self.routes = {}

    def _route(self, method):
        def register(path):
            def decorate(fn):
                self.routes[(method, path)] = fn
                return fn
            return decorate
        return register

    def __getattr__(self, name):
        if name in ("get", "post"):
            return self._route(name.upper())
        raise AttributeError(name)


def import_app():
    """Import inspector/app.py. With Flask installed it is the real app (test_client usable); without it a minimal fake
    `flask` module stands in. Import errors propagate — nothing is swallowed."""
    if not have("flask") and "flask" not in sys.modules:
        fake = types.ModuleType("flask")
        fake.Flask = _FakeFlask
        fake.request = types.SimpleNamespace(get_json=lambda **_k: {})
        fake.jsonify = lambda *a, **k: (a, k)
        fake.IS_FAKE = True
        sys.modules["flask"] = fake
    return importlib.import_module("app")


def main():
    unittest.main(verbosity=2)
