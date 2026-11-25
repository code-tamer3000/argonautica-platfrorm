from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StrictInt, StrictStr, StringConstraints

NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class StructureQuestion(BaseModel):
    id: NonBlank
    label: NonBlank
    kind: Literal["text", "scale"]


class StructureEntryCreate(BaseModel):
    answers: dict[str, StrictStr | StrictInt]


class StructureEntryOut(BaseModel):
    id: int
    created_at: datetime
    answers: dict[str, str | int]


Questions = Annotated[list[StructureQuestion], Field(min_length=1)]
