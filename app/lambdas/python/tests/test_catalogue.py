"""An access role must exist in every layer: policy catalogue, console link, Terraform target role and UI."""

import pathlib
import re

from handlers import start_session
from jit.policy import ACCESS_ROLES

REPO = pathlib.Path(__file__).resolve().parents[4]
CATALOGUE = set(ACCESS_ROLES)


def test_every_role_has_a_console_destination():
    assert set(start_session.CONSOLE_DESTINATIONS) == CATALOGUE


def test_every_role_has_a_terraform_target_role():
    targets_tf = (REPO / "platform/targets.tf").read_text()
    block = targets_tf[targets_tf.index("targets = {") :]
    block = block[: block.index("\n  }\n")]
    assert set(re.findall(r'"(prod-[a-z0-9-]+)"\s*=', block)) == CATALOGUE


def test_every_role_is_offered_in_the_ui():
    main_ts = (REPO / "web/src/main.ts").read_text()
    assert set(re.findall(r"name: '(prod-[a-z0-9-]+)'", main_ts)) == CATALOGUE


def test_role_names_follow_the_convention():
    for name in CATALOGUE:
        assert re.fullmatch(r"prod-[a-z0-9]+(-[a-z0-9]+)*", name), name
