from app.api.response import fail, ok


def test_ok_default():
    result = ok()
    assert result == {"success": True, "data": None, "message": "ok"}


def test_ok_with_data():
    result = ok(data={"key": "value"}, message="done")
    assert result["success"] is True
    assert result["data"] == {"key": "value"}
    assert result["message"] == "done"


def test_fail_default():
    result = fail()
    assert result == {"success": False, "data": None, "message": "error"}


def test_fail_with_message():
    result = fail(message="not found", data={"id": 1})
    assert result["success"] is False
    assert result["message"] == "not found"
    assert result["data"] == {"id": 1}
