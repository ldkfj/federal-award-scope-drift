import json

import pytest


CONTRACT = "contracts/FederalAwardScopeDrift.py"
AWARD_ID = "CONT_AWD_47PF0021C0003_4740_-NONE-_-NONE-"
RECIPIENT_UEI = "VEP4UN7LDMK5"
CLAIM_URL = "https://www.gsa.gov/about-us/gsa-regions/region-5-great-lakes/buildings-and-facilities/ohio/ashley-us-courthouse"
CLAIM_TEXT = "GSA awarded $85,535,000 for the Ashley U.S. Courthouse project."


def register_and_freeze(contract):
    claim_id = contract.register_claim(AWARD_ID, RECIPIENT_UEI, CLAIM_TEXT, CLAIM_URL, "2020-10-26")
    contract.freeze_claim(claim_id)
    return claim_id


def mock_assessment(
    direct_vm,
    *,
    scope="ALIGNED",
    time_relation="ALIGNED",
    amount="8553500000",
    recipient_uei=RECIPIENT_UEI,
    source_text=CLAIM_TEXT,
    transaction_count=1,
    count_status=200,
):
    detail = {
        "generated_unique_award_id": AWARD_ID,
        "piid": "47PF0021C0003",
        "type": "D",
        "description": "Ashley U.S. Courthouse construction",
        "total_obligation": 85535000,
        "recipient": {"recipient_name": "General Services Administration", "recipient_uei": recipient_uei},
        "awarding_agency": {"toptier_agency": {"name": "General Services Administration"}},
        "period_of_performance": {"start_date": "2020-10-26", "end_date": "2025-10-25"},
    }
    transactions = {
        "results": [{
            "Award ID": "47PF0021C0003",
            "Recipient Name": "General Services Administration",
            "Recipient UEI": RECIPIENT_UEI,
            "Action Date": "2020-10-26",
            "Action Type": "A",
            "Mod": "0",
            "Transaction Description": "Ashley U.S. Courthouse construction",
            "Transaction Amount": 85535000,
            "Award Type": "D",
        }],
    }
    direct_vm.mock_web(r"/awards/count/transaction/", {"method": "GET", "status": count_status, "body": json.dumps({"transactions": transaction_count})})
    direct_vm.mock_web(r"/awards/CONT_AWD_", {"method": "GET", "status": 200, "body": json.dumps(detail)})
    direct_vm.mock_web(r"/search/spending_by_transaction/", {"method": "POST", "status": 200, "body": json.dumps(transactions)})
    direct_vm.mock_web(r"gsa\.gov/", {"method": "GET", "status": 200, "body": source_text})
    direct_vm.mock_llm(
        r"classifying a frozen public statement",
        json.dumps({
            "scope_relation": scope,
            "time_relation": time_relation,
            "claim_amount_cents": amount,
            "amount_qualifier": "EXACT",
            "material_change_after_observation": False,
            "analysis": "The frozen claim matches the official award chain.",
        }),
    )


def test_registers_claim_with_canonical_binding(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)

    with direct_vm.prank(direct_alice):
        claim_id = contract.register_claim(
            AWARD_ID,
            RECIPIENT_UEI,
            CLAIM_TEXT,
            CLAIM_URL,
            "2020-10-26",
        )

    assert claim_id == "FASD-000001"
    claim = json.loads(contract.get_claim(claim_id))
    assert claim["award_id"] == AWARD_ID
    assert claim["recipient_id"] == RECIPIENT_UEI
    assert claim["status"] == "REGISTERED"
    assert claim["registrant"].lower() == f"0x{direct_alice.hex()}"


def test_only_registrant_can_freeze(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    with direct_vm.prank(direct_alice):
        claim_id = contract.register_claim(
            AWARD_ID,
            RECIPIENT_UEI,
            CLAIM_TEXT,
            CLAIM_URL,
            "2020-10-26",
        )

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the registrant can freeze this claim"):
            contract.freeze_claim(claim_id)

    with direct_vm.prank(direct_alice):
        contract.freeze_claim(claim_id)
    assert json.loads(contract.get_claim(claim_id))["status"] == "FROZEN"


def test_rejects_non_public_or_non_https_claim_urls(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)

    for bad_url in (
        "http://example.com/claim",
        "https://localhost/claim",
        "https://127.0.0.1/claim",
        "https://user:pass@example.com/claim",
    ):
        with direct_vm.expect_revert("Claim URL must be public HTTPS"):
            contract.register_claim(
                AWARD_ID,
                RECIPIENT_UEI,
                "A sufficiently long public award claim for validation.",
                bad_url,
                "2020-10-26",
            )


def test_assessment_requires_frozen_claim(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    claim_id = contract.register_claim(
        AWARD_ID,
        RECIPIENT_UEI,
        CLAIM_TEXT,
        CLAIM_URL,
        "2020-10-26",
    )

    with direct_vm.expect_revert("Claim must be frozen before assessment"):
        contract.assess_current_scope(claim_id)


def test_assessment_records_current_alignment_and_supports_reassessment(direct_vm, direct_deploy):
    direct_vm.check_pickling = True
    direct_vm.warp("2026-01-01T00:00:00Z")
    contract = direct_deploy(CONTRACT)
    claim_id = register_and_freeze(contract)
    mock_assessment(direct_vm)

    assessment = json.loads(contract.assess_current_scope(claim_id))
    assert assessment["verdict"] == "CURRENTLY_ALIGNED"
    assert assessment["revision"] == 1
    assert assessment["award_snapshot"]["last_action_date"] == "2020-10-26"
    claim = json.loads(contract.get_claim(claim_id))
    assert claim["status"] == "ASSESSED"
    assert claim["update_required"] is False

    with direct_vm.expect_revert("Expected last action date does not match authoritative state"):
        contract.reassess_after_update(claim_id, "2020-10-25")
    with direct_vm.expect_revert("Assessment cooldown has not elapsed"):
        contract.reassess_after_update(claim_id, "2020-10-26")
    direct_vm.warp("2026-01-02T00:00:00Z")
    reassessment = json.loads(contract.reassess_after_update(claim_id, "2020-10-26"))
    assert reassessment["revision"] == 2


def test_retry_cooldown_boundary(direct_vm, direct_deploy):
    direct_vm.warp("2026-01-01T00:00:00Z")
    contract = direct_deploy(CONTRACT)
    claim_id = register_and_freeze(contract)
    mock_assessment(direct_vm, transaction_count=101)
    contract.assess_current_scope(claim_id)

    direct_vm.warp("2026-01-01T23:59:59Z")
    with direct_vm.expect_revert("Assessment cooldown has not elapsed"):
        contract.assess_current_scope(claim_id)
    direct_vm.warp("2026-01-02T00:00:00Z")
    assert json.loads(contract.assess_current_scope(claim_id))["revision"] == 2


def test_config_exposes_contract_limits(direct_deploy):
    config = json.loads(direct_deploy(CONTRACT).get_config())
    assert config == {
        "max_claims": 999999,
        "max_transactions": 100,
        "reassess_cooldown_seconds": 86400,
    }


def test_deployer_is_recorded_as_upgrader(direct_deploy, direct_owner):
    contract = direct_deploy(CONTRACT)
    assert contract.get_upgrader().as_bytes == direct_owner


def test_upgrade_path_rejects_non_upgrader_and_accepts_deployer(direct_vm, direct_deploy, direct_owner, direct_bob):
    contract = direct_deploy(CONTRACT)
    replacement = b"# isolated Direct Mode upgrade rehearsal"

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the recorded upgrader can replace code"):
            contract.upgrade(replacement)

    with direct_vm.prank(direct_owner):
        contract.upgrade(replacement)


def test_validator_rejects_a_semantically_different_scope_result(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    claim_id = register_and_freeze(contract)
    mock_assessment(direct_vm)
    assert json.loads(contract.assess_current_scope(claim_id))["verdict"] == "CURRENTLY_ALIGNED"

    direct_vm.clear_mocks()
    mock_assessment(direct_vm, scope="BROADER_THAN_CURRENT")
    assert direct_vm.run_validator() is False


def test_unavailable_transaction_history_remains_retryable(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    claim_id = register_and_freeze(contract)
    mock_assessment(direct_vm, transaction_count=101)

    assessment = json.loads(contract.assess_current_scope(claim_id))
    claim = json.loads(contract.get_claim(claim_id))
    assert assessment["verdict"] == "UNRESOLVED"
    assert assessment["reason_codes"] == ["TRANSACTION_LIMIT_EXCEEDED"]
    assert claim["status"] == "FROZEN"
    assert claim["update_required"] is True


@pytest.mark.parametrize(
    ("mock_kwargs", "expected_verdict"),
    [
        ({"scope": "BROADER_THAN_CURRENT"}, "SCOPE_DRIFT"),
        ({"scope": "AMBIGUOUS"}, "QUALIFICATION_REQUIRED"),
        ({"time_relation": "STALE"}, "STALE_CLAIM"),
        ({"recipient_uei": "ABCDEF123456"}, "IDENTITY_MISMATCH"),
        ({"source_text": "The exact frozen wording is absent."}, "UNRESOLVED"),
    ],
)
def test_consequential_verdict_matrix(direct_vm, direct_deploy, mock_kwargs, expected_verdict):
    contract = direct_deploy(CONTRACT)
    claim_id = register_and_freeze(contract)
    mock_assessment(direct_vm, **mock_kwargs)

    assessment = json.loads(contract.assess_current_scope(claim_id))
    assert assessment["verdict"] == expected_verdict


def test_http_failure_is_unresolved_and_retryable(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    claim_id = register_and_freeze(contract)
    mock_assessment(direct_vm, count_status=503)

    assessment = json.loads(contract.assess_current_scope(claim_id))
    claim = json.loads(contract.get_claim(claim_id))
    assert assessment["verdict"] == "UNRESOLVED"
    assert assessment["reason_codes"] == ["HTTP_503"]
    assert claim["status"] == "FROZEN"
