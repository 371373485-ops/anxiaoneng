"""Remediation task routes (CRUD + reviews)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..shared import (
    ReviewInput,
    TaskInput,
    TaskPatch,
    Identity,
    assert_branch,
    audit,
    get_diagnosis,
    identity,
    new_id,
    now_iso,
    task_response,
    db,
)
from ..domain import (
    classify_review,
    next_task_state,
    validate_task_fields,
)

router = APIRouter()
