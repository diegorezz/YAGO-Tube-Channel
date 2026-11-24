from fastapi.testclient import TestClient

from app.main import app


def test_health_and_fair_use_endpoints():
    with TestClient(app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"

        fu = client.get("/api/fair-use", headers={"X-User-Id": "test-user-01"})
        assert fu.status_code == 200
        fu_data = fu.json()
        assert fu_data["can_submit"] is True
        assert fu_data["max_clips_per_job"] == 50

        lib = client.get("/api/library", headers={"X-User-Id": "test-user-01"})
        assert lib.status_code == 200
        assert isinstance(lib.json(), list)
