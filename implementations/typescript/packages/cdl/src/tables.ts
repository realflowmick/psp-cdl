// SPDX-License-Identifier: CC0-1.0
// Generated verbatim from conformance/policy; verified by library tests.
export const tableData = {
  "profile": "CDL-DETERMINISTIC-1.0",
  "version": "1.0",
  "status": "proposed-standard",
  "base": "CDL-1.5",
  "classes": [
    "ai-assisted",
    "ai-generated",
    "ai-gpai-model",
    "ai-gpai-systemic-risk",
    "ai-high-risk",
    "ai-limited-risk",
    "ai-minimal-risk",
    "ai-unacceptable-risk",
    "ccpa-subject",
    "confidential",
    "coppa-subject",
    "credentials",
    "deepfake",
    "developmental-disability-information",
    "directory-information",
    "educational-record",
    "employment-record",
    "export-controlled",
    "financial",
    "gdpr-subject",
    "genetic-information",
    "hiv-information",
    "internal",
    "legal-privileged",
    "low",
    "minor-health-information",
    "normal",
    "pci",
    "phi",
    "pii",
    "psychiatric-information",
    "public",
    "reproductive-health-information",
    "restricted",
    "secret",
    "sexual-violence-information",
    "social-services-information",
    "substance-use-information",
    "synthetic-media",
    "taboo-information"
  ],
  "capabilities": [
    "42-cfr-part-2-compliant",
    "accountable-transparent-ai",
    "appears-in-directory",
    "builds-profiles",
    "can-aggregate",
    "can-cache",
    "can-call-external-api",
    "can-create-audit-trail",
    "can-de-identify",
    "can-derive",
    "can-display",
    "can-display-to-operator",
    "can-distribute",
    "can-execute",
    "can-extract",
    "can-index",
    "can-modify",
    "can-post-to-web",
    "can-print",
    "can-process-phi",
    "can-send-email",
    "can-send-sms",
    "can-share",
    "can-transform",
    "can-translate",
    "can-transmit-externally",
    "can-write-database",
    "can-write-filesystem",
    "can-write-storage",
    "checks-operator-role",
    "collects-data",
    "collects-derived-only",
    "commercial-use",
    "creates-audit-trail",
    "creates-embeddings",
    "discloses-ai-nature",
    "discloses-to-data-subject",
    "discloses-to-government",
    "displays-raw-data",
    "documents-risk-management-system",
    "encrypts-at-rest",
    "encrypts-in-transit",
    "encrypts-in-use",
    "enforces-mfa",
    "enforces-rbac",
    "enforces-share-alike",
    "eu-ai-act-compliant",
    "explainable-ai",
    "fair-bias-managed-ai",
    "gates-subject-disclosure",
    "gdpr-compliant",
    "gina-compliant",
    "hipaa-compliant",
    "indexes-for-rag",
    "interpretable-ai",
    "is-ai-system",
    "is-gpai-model",
    "is-high-risk-ai",
    "iso-iec-27001-certified",
    "iso-iec-42001-certified",
    "logs-data",
    "logs-display-events",
    "logs-operations",
    "makes-automated-decisions",
    "marks-ai-generated-content",
    "nist-ai-rmf-aligned",
    "no-logging",
    "no-training-use",
    "passed-conformity-assessment",
    "persists-data",
    "preserves-attribution",
    "privacy-enhanced-ai",
    "processes-in-jurisdiction-eu",
    "processes-in-jurisdiction-us",
    "processes-in-memory-only",
    "provides-human-oversight",
    "safe-ai",
    "secondary-use",
    "secure-resilient-ai",
    "supports-deletion-after-use",
    "supports-redaction",
    "supports-right-of-access",
    "supports-right-of-erasure",
    "supports-right-of-portability",
    "supports-right-of-rectification",
    "supports-right-to-object",
    "supports-secure-enclave",
    "supports-summarization",
    "tracks-usage",
    "transient-processing-only",
    "used-for-analytics",
    "used-for-model-training",
    "validated-and-reliable",
    "verifies-agreement",
    "verifies-agreement-baa",
    "verifies-agreement-dua",
    "verifies-agreement-mou",
    "verifies-consent-recency",
    "verifies-consent-record",
    "verifies-contract-active",
    "verifies-legal-obligation",
    "verifies-legitimate-interest-assessment",
    "verifies-organizational-policy",
    "verifies-parental-consent",
    "verifies-professional-determination",
    "verifies-public-task-authority",
    "verifies-subject-authorization",
    "verifies-vital-interests"
  ],
  "rules": [
    {
      "id": "class:ai-high-risk",
      "kind": "class",
      "term": "ai-high-risk",
      "conflictUnless": {
        "any": [
          "is-ai-system"
        ],
        "unlessAny": [
          "passed-conformity-assessment"
        ]
      },
      "check": "ai-high-risk",
      "checkWhenAny": [
        "is-ai-system"
      ]
    },
    {
      "id": "class:ai-unacceptable-risk",
      "kind": "class",
      "term": "ai-unacceptable-risk",
      "conflictAny": [
        "is-ai-system"
      ]
    },
    {
      "id": "covenant:42-cfr-part-2",
      "kind": "covenant",
      "term": "42-cfr-part-2",
      "requireAll": [
        "42-cfr-part-2-compliant"
      ],
      "check": "42-cfr-part-2"
    },
    {
      "id": "covenant:accountable-transparent-ai-required",
      "kind": "covenant",
      "term": "accountable-transparent-ai-required",
      "requireAll": [
        "accountable-transparent-ai"
      ],
      "check": "accountable-transparent-ai-required"
    },
    {
      "id": "covenant:agreement-required",
      "kind": "covenant",
      "term": "agreement-required",
      "requireAll": [
        "verifies-agreement"
      ],
      "check": "agreement-required"
    },
    {
      "id": "covenant:agreement-required-baa",
      "kind": "covenant",
      "term": "agreement-required-baa",
      "requireAll": [
        "verifies-agreement-baa"
      ],
      "check": "agreement-required-baa"
    },
    {
      "id": "covenant:agreement-required-dua",
      "kind": "covenant",
      "term": "agreement-required-dua",
      "requireAll": [
        "verifies-agreement-dua"
      ],
      "check": "agreement-required-dua"
    },
    {
      "id": "covenant:agreement-required-mou",
      "kind": "covenant",
      "term": "agreement-required-mou",
      "requireAll": [
        "verifies-agreement-mou"
      ],
      "check": "agreement-required-mou"
    },
    {
      "id": "covenant:ai-generated-content-marked",
      "kind": "covenant",
      "term": "ai-generated-content-marked",
      "requireAll": [
        "marks-ai-generated-content"
      ],
      "check": "ai-generated-content-marked"
    },
    {
      "id": "covenant:attribution-required",
      "kind": "covenant",
      "term": "attribution-required",
      "requireAll": [
        "preserves-attribution"
      ],
      "check": "attribution-required"
    },
    {
      "id": "covenant:audit-on-display",
      "kind": "covenant",
      "term": "audit-on-display",
      "requireAll": [
        "logs-display-events"
      ],
      "check": "audit-on-display"
    },
    {
      "id": "covenant:audit-required",
      "kind": "covenant",
      "term": "audit-required",
      "requireAny": [
        "creates-audit-trail",
        "logs-operations"
      ],
      "check": "audit-required"
    },
    {
      "id": "covenant:conformity-assessment-required",
      "kind": "covenant",
      "term": "conformity-assessment-required",
      "requireAll": [
        "passed-conformity-assessment"
      ],
      "check": "conformity-assessment-required"
    },
    {
      "id": "covenant:consent-current-required",
      "kind": "covenant",
      "term": "consent-current-required",
      "requireAll": [
        "verifies-consent-recency"
      ],
      "check": "consent-current-required"
    },
    {
      "id": "covenant:de-identification-required",
      "kind": "covenant",
      "term": "de-identification-required",
      "requireAll": [
        "can-de-identify"
      ],
      "check": "de-identification-required"
    },
    {
      "id": "covenant:delete-after-use",
      "kind": "covenant",
      "term": "delete-after-use",
      "requireAll": [
        "supports-deletion-after-use"
      ],
      "check": "delete-after-use"
    },
    {
      "id": "covenant:encryption-in-use",
      "kind": "covenant",
      "term": "encryption-in-use",
      "requireAny": [
        "encrypts-in-use",
        "supports-secure-enclave"
      ],
      "check": "encryption-in-use"
    },
    {
      "id": "covenant:encryption-required",
      "kind": "covenant",
      "term": "encryption-required",
      "requireAll": [
        "encrypts-at-rest",
        "encrypts-in-transit"
      ],
      "check": "encryption-required"
    },
    {
      "id": "covenant:eu-ai-act",
      "kind": "covenant",
      "term": "eu-ai-act",
      "requireAll": [
        "eu-ai-act-compliant"
      ],
      "check": "eu-ai-act"
    },
    {
      "id": "covenant:explainable-ai-required",
      "kind": "covenant",
      "term": "explainable-ai-required",
      "requireAll": [
        "explainable-ai"
      ],
      "check": "explainable-ai-required"
    },
    {
      "id": "covenant:fair-bias-managed-required",
      "kind": "covenant",
      "term": "fair-bias-managed-required",
      "requireAll": [
        "fair-bias-managed-ai"
      ],
      "check": "fair-bias-managed-required"
    },
    {
      "id": "covenant:gdpr",
      "kind": "covenant",
      "term": "gdpr",
      "requireAll": [
        "gdpr-compliant"
      ],
      "check": "gdpr"
    },
    {
      "id": "covenant:gina",
      "kind": "covenant",
      "term": "gina",
      "requireAll": [
        "gina-compliant"
      ],
      "check": "gina"
    },
    {
      "id": "covenant:hipaa",
      "kind": "covenant",
      "term": "hipaa",
      "requireAll": [
        "can-process-phi",
        "hipaa-compliant"
      ],
      "check": "hipaa"
    },
    {
      "id": "covenant:human-oversight-required",
      "kind": "covenant",
      "term": "human-oversight-required",
      "requireAll": [
        "provides-human-oversight"
      ],
      "check": "human-oversight-required"
    },
    {
      "id": "covenant:interpretable-ai-required",
      "kind": "covenant",
      "term": "interpretable-ai-required",
      "requireAll": [
        "interpretable-ai"
      ],
      "check": "interpretable-ai-required"
    },
    {
      "id": "covenant:iso-iec-27001",
      "kind": "covenant",
      "term": "iso-iec-27001",
      "requireAll": [
        "iso-iec-27001-certified"
      ],
      "check": "iso-iec-27001"
    },
    {
      "id": "covenant:iso-iec-42001",
      "kind": "covenant",
      "term": "iso-iec-42001",
      "requireAll": [
        "iso-iec-42001-certified"
      ],
      "check": "iso-iec-42001"
    },
    {
      "id": "covenant:lawful-basis-consent",
      "kind": "covenant",
      "term": "lawful-basis-consent",
      "requireAll": [
        "verifies-consent-record"
      ],
      "check": "lawful-basis-consent",
      "group": "article6"
    },
    {
      "id": "covenant:lawful-basis-contract",
      "kind": "covenant",
      "term": "lawful-basis-contract",
      "requireAll": [
        "verifies-contract-active"
      ],
      "check": "lawful-basis-contract",
      "group": "article6"
    },
    {
      "id": "covenant:lawful-basis-legal-obligation",
      "kind": "covenant",
      "term": "lawful-basis-legal-obligation",
      "requireAll": [
        "verifies-legal-obligation"
      ],
      "check": "lawful-basis-legal-obligation",
      "group": "article6"
    },
    {
      "id": "covenant:lawful-basis-legitimate-interests",
      "kind": "covenant",
      "term": "lawful-basis-legitimate-interests",
      "requireAll": [
        "verifies-legitimate-interest-assessment"
      ],
      "check": "lawful-basis-legitimate-interests",
      "group": "article6"
    },
    {
      "id": "covenant:lawful-basis-public-task",
      "kind": "covenant",
      "term": "lawful-basis-public-task",
      "requireAll": [
        "verifies-public-task-authority"
      ],
      "check": "lawful-basis-public-task",
      "group": "article6"
    },
    {
      "id": "covenant:lawful-basis-vital-interests",
      "kind": "covenant",
      "term": "lawful-basis-vital-interests",
      "requireAll": [
        "verifies-vital-interests"
      ],
      "check": "lawful-basis-vital-interests",
      "group": "article6"
    },
    {
      "id": "covenant:mfa-required",
      "kind": "covenant",
      "term": "mfa-required",
      "requireAll": [
        "enforces-mfa"
      ],
      "check": "mfa-required"
    },
    {
      "id": "covenant:nist-ai-rmf",
      "kind": "covenant",
      "term": "nist-ai-rmf",
      "requireAll": [
        "nist-ai-rmf-aligned"
      ],
      "check": "nist-ai-rmf"
    },
    {
      "id": "covenant:no-aggregate",
      "kind": "covenant",
      "term": "no-aggregate",
      "conflictAny": [
        "can-aggregate"
      ]
    },
    {
      "id": "covenant:no-automated-decision-making",
      "kind": "covenant",
      "term": "no-automated-decision-making",
      "conflictAny": [
        "makes-automated-decisions"
      ]
    },
    {
      "id": "covenant:no-cache",
      "kind": "covenant",
      "term": "no-cache",
      "conflictAny": [
        "can-cache"
      ]
    },
    {
      "id": "covenant:no-collect",
      "kind": "covenant",
      "term": "no-collect",
      "conflictAny": [
        "collects-data"
      ],
      "forbidProcessing": true
    },
    {
      "id": "covenant:no-commercial-use",
      "kind": "covenant",
      "term": "no-commercial-use",
      "conflictAny": [
        "commercial-use"
      ]
    },
    {
      "id": "covenant:no-derive",
      "kind": "covenant",
      "term": "no-derive",
      "conflictAny": [
        "can-derive"
      ]
    },
    {
      "id": "covenant:no-derived-collection",
      "kind": "covenant",
      "term": "no-derived-collection",
      "conflictAny": [
        "collects-data",
        "collects-derived-only",
        "creates-embeddings",
        "indexes-for-rag",
        "persists-data"
      ],
      "requireAll": [
        "transient-processing-only"
      ],
      "check": "no-derived-collection"
    },
    {
      "id": "covenant:no-directory-listing",
      "kind": "covenant",
      "term": "no-directory-listing",
      "conflictAny": [
        "appears-in-directory"
      ]
    },
    {
      "id": "covenant:no-disclosure-to-subject",
      "kind": "covenant",
      "term": "no-disclosure-to-subject",
      "conflictUnless": {
        "any": [
          "discloses-to-data-subject"
        ],
        "unlessAny": [
          "gates-subject-disclosure"
        ]
      },
      "check": "no-disclosure-to-subject",
      "checkWhenAny": [
        "discloses-to-data-subject"
      ]
    },
    {
      "id": "covenant:no-display",
      "kind": "covenant",
      "term": "no-display",
      "conflictAny": [
        "can-display"
      ]
    },
    {
      "id": "covenant:no-display-to-operator",
      "kind": "covenant",
      "term": "no-display-to-operator",
      "conflictAny": [
        "can-display-to-operator",
        "displays-raw-data"
      ]
    },
    {
      "id": "covenant:no-distribute",
      "kind": "covenant",
      "term": "no-distribute",
      "conflictAny": [
        "can-distribute"
      ]
    },
    {
      "id": "covenant:no-embedding-storage",
      "kind": "covenant",
      "term": "no-embedding-storage",
      "conflictAny": [
        "creates-embeddings"
      ]
    },
    {
      "id": "covenant:no-execute",
      "kind": "covenant",
      "term": "no-execute",
      "conflictAny": [
        "can-execute"
      ]
    },
    {
      "id": "covenant:no-external-transmission",
      "kind": "covenant",
      "term": "no-external-transmission",
      "conflictAny": [
        "can-call-external-api",
        "can-post-to-web",
        "can-send-email",
        "can-send-sms",
        "can-transmit-externally"
      ]
    },
    {
      "id": "covenant:no-extract",
      "kind": "covenant",
      "term": "no-extract",
      "conflictAny": [
        "can-extract"
      ]
    },
    {
      "id": "covenant:no-government-disclosure",
      "kind": "covenant",
      "term": "no-government-disclosure",
      "conflictAny": [
        "discloses-to-government"
      ]
    },
    {
      "id": "covenant:no-index",
      "kind": "covenant",
      "term": "no-index",
      "conflictAny": [
        "can-index"
      ]
    },
    {
      "id": "covenant:no-log",
      "kind": "covenant",
      "term": "no-log",
      "conflictAny": [
        "creates-audit-trail",
        "logs-data",
        "logs-display-events",
        "logs-operations"
      ]
    },
    {
      "id": "covenant:no-modify",
      "kind": "covenant",
      "term": "no-modify",
      "conflictAny": [
        "can-modify"
      ]
    },
    {
      "id": "covenant:no-persist",
      "kind": "covenant",
      "term": "no-persist",
      "conflictAny": [
        "can-cache",
        "can-write-storage",
        "logs-operations",
        "persists-data"
      ]
    },
    {
      "id": "covenant:no-print",
      "kind": "covenant",
      "term": "no-print",
      "conflictAny": [
        "can-print"
      ]
    },
    {
      "id": "covenant:no-profiling",
      "kind": "covenant",
      "term": "no-profiling",
      "conflictAny": [
        "builds-profiles"
      ]
    },
    {
      "id": "covenant:no-rag-indexing",
      "kind": "covenant",
      "term": "no-rag-indexing",
      "conflictAny": [
        "indexes-for-rag"
      ]
    },
    {
      "id": "covenant:no-secondary-use",
      "kind": "covenant",
      "term": "no-secondary-use",
      "conflictAny": [
        "secondary-use"
      ]
    },
    {
      "id": "covenant:no-share",
      "kind": "covenant",
      "term": "no-share",
      "conflictAny": [
        "can-share"
      ]
    },
    {
      "id": "covenant:no-tracking",
      "kind": "covenant",
      "term": "no-tracking",
      "conflictAny": [
        "tracks-usage"
      ]
    },
    {
      "id": "covenant:no-training",
      "kind": "covenant",
      "term": "no-training",
      "conflictAny": [
        "used-for-analytics",
        "used-for-model-training"
      ]
    },
    {
      "id": "covenant:no-transform",
      "kind": "covenant",
      "term": "no-transform",
      "conflictAny": [
        "can-transform"
      ]
    },
    {
      "id": "covenant:no-translate",
      "kind": "covenant",
      "term": "no-translate",
      "conflictAny": [
        "can-translate"
      ]
    },
    {
      "id": "covenant:operator-blind-processing",
      "kind": "covenant",
      "term": "operator-blind-processing",
      "conflictAny": [
        "can-display-to-operator"
      ]
    },
    {
      "id": "covenant:organizational-policy-required",
      "kind": "covenant",
      "term": "organizational-policy-required",
      "requireAll": [
        "verifies-organizational-policy"
      ],
      "check": "organizational-policy-required"
    },
    {
      "id": "covenant:parental-consent-required",
      "kind": "covenant",
      "term": "parental-consent-required",
      "requireAll": [
        "verifies-parental-consent"
      ],
      "check": "parental-consent-required"
    },
    {
      "id": "covenant:privacy-enhanced-ai-required",
      "kind": "covenant",
      "term": "privacy-enhanced-ai-required",
      "requireAll": [
        "privacy-enhanced-ai"
      ],
      "check": "privacy-enhanced-ai-required"
    },
    {
      "id": "covenant:professional-determination-required",
      "kind": "covenant",
      "term": "professional-determination-required",
      "requireAll": [
        "verifies-professional-determination"
      ],
      "check": "professional-determination-required"
    },
    {
      "id": "covenant:redacted-display-only",
      "kind": "covenant",
      "term": "redacted-display-only",
      "conflictUnless": {
        "any": [
          "displays-raw-data"
        ],
        "unlessAny": [
          "supports-redaction"
        ]
      },
      "requireAll": [
        "supports-redaction"
      ],
      "check": "redacted-display-only"
    },
    {
      "id": "covenant:right-of-access",
      "kind": "covenant",
      "term": "right-of-access",
      "requireAll": [
        "supports-right-of-access"
      ],
      "check": "right-of-access"
    },
    {
      "id": "covenant:right-of-erasure",
      "kind": "covenant",
      "term": "right-of-erasure",
      "requireAll": [
        "supports-right-of-erasure"
      ],
      "check": "right-of-erasure"
    },
    {
      "id": "covenant:right-of-portability",
      "kind": "covenant",
      "term": "right-of-portability",
      "requireAll": [
        "supports-right-of-portability"
      ],
      "check": "right-of-portability"
    },
    {
      "id": "covenant:right-of-rectification",
      "kind": "covenant",
      "term": "right-of-rectification",
      "requireAll": [
        "supports-right-of-rectification"
      ],
      "check": "right-of-rectification"
    },
    {
      "id": "covenant:right-to-object",
      "kind": "covenant",
      "term": "right-to-object",
      "requireAll": [
        "supports-right-to-object"
      ],
      "check": "right-to-object"
    },
    {
      "id": "covenant:risk-management-system-required",
      "kind": "covenant",
      "term": "risk-management-system-required",
      "requireAll": [
        "documents-risk-management-system"
      ],
      "check": "risk-management-system-required"
    },
    {
      "id": "covenant:role-based-access",
      "kind": "covenant",
      "term": "role-based-access",
      "requireAll": [
        "enforces-rbac"
      ],
      "check": "role-based-access"
    },
    {
      "id": "covenant:role-restricted-display",
      "kind": "covenant",
      "term": "role-restricted-display",
      "requireAll": [
        "checks-operator-role"
      ],
      "check": "role-restricted-display",
      "parameter": "roles"
    },
    {
      "id": "covenant:safe-ai-required",
      "kind": "covenant",
      "term": "safe-ai-required",
      "requireAll": [
        "safe-ai"
      ],
      "check": "safe-ai-required"
    },
    {
      "id": "covenant:secure-resilient-ai-required",
      "kind": "covenant",
      "term": "secure-resilient-ai-required",
      "requireAll": [
        "secure-resilient-ai"
      ],
      "check": "secure-resilient-ai-required"
    },
    {
      "id": "covenant:share-alike-required",
      "kind": "covenant",
      "term": "share-alike-required",
      "requireAll": [
        "enforces-share-alike"
      ],
      "check": "share-alike-required"
    },
    {
      "id": "covenant:subject-authorization-required",
      "kind": "covenant",
      "term": "subject-authorization-required",
      "requireAll": [
        "verifies-subject-authorization"
      ],
      "check": "subject-authorization-required"
    },
    {
      "id": "covenant:summary-only-display",
      "kind": "covenant",
      "term": "summary-only-display",
      "requireAll": [
        "supports-summarization"
      ],
      "check": "summary-only-display"
    },
    {
      "id": "covenant:transparency-disclosure-required",
      "kind": "covenant",
      "term": "transparency-disclosure-required",
      "requireAll": [
        "discloses-ai-nature"
      ],
      "check": "transparency-disclosure-required"
    },
    {
      "id": "covenant:valid-and-reliable-required",
      "kind": "covenant",
      "term": "valid-and-reliable-required",
      "requireAll": [
        "validated-and-reliable"
      ],
      "check": "valid-and-reliable-required"
    },
    {
      "id": "covenant:within-jurisdiction-only",
      "kind": "covenant",
      "term": "within-jurisdiction-only",
      "parameter": "jurisdictions",
      "check": "within-jurisdiction-only"
    }
  ],
  "implications": {
    "can-cache": [
      "persists-data"
    ],
    "can-call-external-api": [
      "can-transmit-externally"
    ],
    "can-create-audit-trail": [
      "creates-audit-trail"
    ],
    "can-display-to-operator": [
      "can-display"
    ],
    "can-post-to-web": [
      "can-transmit-externally"
    ],
    "can-send-email": [
      "can-transmit-externally"
    ],
    "can-send-sms": [
      "can-transmit-externally"
    ],
    "can-write-database": [
      "can-write-storage"
    ],
    "can-write-filesystem": [
      "can-write-storage"
    ],
    "can-write-storage": [
      "persists-data"
    ],
    "collects-data": [
      "persists-data"
    ],
    "collects-derived-only": [
      "persists-data"
    ],
    "creates-audit-trail": [
      "persists-data"
    ],
    "creates-embeddings": [
      "persists-data"
    ],
    "displays-raw-data": [
      "can-display-to-operator"
    ],
    "indexes-for-rag": [
      "can-index",
      "persists-data"
    ],
    "is-gpai-model": [
      "is-ai-system"
    ],
    "is-high-risk-ai": [
      "is-ai-system"
    ],
    "logs-data": [
      "persists-data"
    ],
    "logs-display-events": [
      "persists-data"
    ],
    "logs-operations": [
      "persists-data"
    ],
    "verifies-agreement-baa": [
      "verifies-agreement"
    ],
    "verifies-agreement-dua": [
      "verifies-agreement"
    ],
    "verifies-agreement-mou": [
      "verifies-agreement"
    ]
  },
  "reasonStages": [
    [
      "INVALID_DECLARATION",
      "LIMIT_EXCEEDED",
      "CONTRADICTORY_DECLARATION"
    ],
    [
      "UNSUPPORTED_TERM",
      "UNSUPPORTED_SCHEMA"
    ],
    [
      "UNTRUSTED_DECLARATION",
      "SCOPE_MISMATCH",
      "STALE_CONTEXT",
      "INCOMPLETE_CAPABILITIES",
      "INVALID_CONTEXT"
    ],
    [
      "INVALID_NEGATION",
      "UNAUTHORIZED_NEGATION"
    ],
    [
      "TOPOLOGY_INSUFFICIENT",
      "MEDIATION_INCOMPLETE"
    ],
    [
      "PROCESSING_PROHIBITED",
      "CAPABILITY_CONFLICT"
    ],
    [
      "MISSING_CONTEXT",
      "ROLE_MISMATCH",
      "JURISDICTION_MISMATCH",
      "REQUIREMENT_UNSATISFIED",
      "CHECK_UNSATISFIED",
      "LEGAL_BASIS_UNSATISFIED"
    ]
  ],
  "appendixCoverage": [
    {
      "section": "B.2",
      "row": "no-persist",
      "rules": [
        "covenant:no-persist"
      ]
    },
    {
      "section": "B.2",
      "row": "no-training",
      "rules": [
        "covenant:no-training"
      ]
    },
    {
      "section": "B.2",
      "row": "no-external-transmission",
      "rules": [
        "covenant:no-external-transmission"
      ]
    },
    {
      "section": "B.2",
      "row": "no-log",
      "rules": [
        "covenant:no-log"
      ]
    },
    {
      "section": "B.2",
      "row": "no-cache",
      "rules": [
        "covenant:no-cache"
      ]
    },
    {
      "section": "B.2",
      "row": "encryption-required",
      "rules": [
        "covenant:encryption-required"
      ]
    },
    {
      "section": "B.2",
      "row": "no-display-to-operator",
      "rules": [
        "covenant:no-display-to-operator"
      ]
    },
    {
      "section": "B.2",
      "row": "operator-blind-processing",
      "rules": [
        "covenant:operator-blind-processing"
      ]
    },
    {
      "section": "B.2",
      "row": "redacted-display-only",
      "rules": [
        "covenant:redacted-display-only"
      ]
    },
    {
      "section": "B.2",
      "row": "role-restricted-display",
      "rules": [
        "covenant:role-restricted-display"
      ]
    },
    {
      "section": "B.2",
      "row": "no-collect",
      "rules": [
        "covenant:no-collect"
      ]
    },
    {
      "section": "B.2",
      "row": "no-derived-collection",
      "rules": [
        "covenant:no-derived-collection"
      ]
    },
    {
      "section": "B.2",
      "row": "no-government-disclosure",
      "rules": [
        "covenant:no-government-disclosure"
      ]
    },
    {
      "section": "B.2",
      "row": "no-directory-listing",
      "rules": [
        "covenant:no-directory-listing"
      ]
    },
    {
      "section": "B.2",
      "row": "no-disclosure-to-subject",
      "rules": [
        "covenant:no-disclosure-to-subject"
      ]
    },
    {
      "section": "B.2",
      "row": "no-embedding-storage",
      "rules": [
        "covenant:no-embedding-storage"
      ]
    },
    {
      "section": "B.2",
      "row": "no-rag-indexing",
      "rules": [
        "covenant:no-rag-indexing"
      ]
    },
    {
      "section": "B.2",
      "row": "subject-authorization-required",
      "rules": [
        "covenant:subject-authorization-required"
      ]
    },
    {
      "section": "B.2",
      "row": "agreement-required",
      "rules": [
        "covenant:agreement-required"
      ]
    },
    {
      "section": "B.2",
      "row": "agreement-required-{type}",
      "rules": [
        "covenant:agreement-required-baa",
        "covenant:agreement-required-dua",
        "covenant:agreement-required-mou"
      ],
      "resolution": "Finite expansion: baa, dua and mou; other types are unsupported."
    },
    {
      "section": "B.2",
      "row": "organizational-policy-required",
      "rules": [
        "covenant:organizational-policy-required"
      ]
    },
    {
      "section": "B.2",
      "row": "consent-current-required",
      "rules": [
        "covenant:consent-current-required"
      ]
    },
    {
      "section": "B.2",
      "row": "parental-consent-required",
      "rules": [
        "covenant:parental-consent-required"
      ]
    },
    {
      "section": "B.2",
      "row": "professional-determination-required",
      "rules": [
        "covenant:professional-determination-required"
      ]
    },
    {
      "section": "B.2",
      "row": "encryption-in-use",
      "rules": [
        "covenant:encryption-in-use"
      ]
    },
    {
      "section": "B.2",
      "row": "de-identification-required",
      "rules": [
        "covenant:de-identification-required"
      ]
    },
    {
      "section": "B.2",
      "row": "delete-after-use",
      "rules": [
        "covenant:delete-after-use"
      ]
    },
    {
      "section": "B.2",
      "row": "within-jurisdiction-only",
      "rules": [
        "covenant:within-jurisdiction-only"
      ]
    },
    {
      "section": "B.2",
      "row": "no-derive",
      "rules": [
        "covenant:no-derive"
      ]
    },
    {
      "section": "B.2",
      "row": "no-aggregate",
      "rules": [
        "covenant:no-aggregate"
      ]
    },
    {
      "section": "B.2",
      "row": "no-extract",
      "rules": [
        "covenant:no-extract"
      ]
    },
    {
      "section": "B.2",
      "row": "no-index",
      "rules": [
        "covenant:no-index"
      ]
    },
    {
      "section": "B.2",
      "row": "no-distribute",
      "rules": [
        "covenant:no-distribute"
      ]
    },
    {
      "section": "B.2",
      "row": "no-share",
      "rules": [
        "covenant:no-share"
      ]
    },
    {
      "section": "B.2",
      "row": "no-modify",
      "rules": [
        "covenant:no-modify"
      ]
    },
    {
      "section": "B.2",
      "row": "no-transform",
      "rules": [
        "covenant:no-transform"
      ]
    },
    {
      "section": "B.2",
      "row": "no-translate",
      "rules": [
        "covenant:no-translate"
      ]
    },
    {
      "section": "B.2",
      "row": "no-print",
      "rules": [
        "covenant:no-print"
      ]
    },
    {
      "section": "B.2",
      "row": "no-display",
      "rules": [
        "covenant:no-display"
      ]
    },
    {
      "section": "B.2",
      "row": "no-execute",
      "rules": [
        "covenant:no-execute"
      ]
    },
    {
      "section": "B.2",
      "row": "no-commercial-use",
      "rules": [
        "covenant:no-commercial-use"
      ]
    },
    {
      "section": "B.2",
      "row": "no-secondary-use",
      "rules": [
        "covenant:no-secondary-use"
      ]
    },
    {
      "section": "B.2",
      "row": "no-tracking",
      "rules": [
        "covenant:no-tracking"
      ]
    },
    {
      "section": "B.2",
      "row": "no-profiling",
      "rules": [
        "covenant:no-profiling"
      ]
    },
    {
      "section": "B.2",
      "row": "no-automated-decision-making",
      "rules": [
        "covenant:no-automated-decision-making"
      ]
    },
    {
      "section": "B.2",
      "row": "attribution-required",
      "rules": [
        "covenant:attribution-required"
      ]
    },
    {
      "section": "B.2",
      "row": "share-alike-required",
      "rules": [
        "covenant:share-alike-required"
      ]
    },
    {
      "section": "B.2",
      "row": "lawful-basis-consent",
      "rules": [
        "covenant:lawful-basis-consent"
      ]
    },
    {
      "section": "B.2",
      "row": "lawful-basis-contract",
      "rules": [
        "covenant:lawful-basis-contract"
      ]
    },
    {
      "section": "B.2",
      "row": "lawful-basis-legitimate-interests",
      "rules": [
        "covenant:lawful-basis-legitimate-interests"
      ]
    },
    {
      "section": "B.2",
      "row": "human-oversight-required",
      "rules": [
        "covenant:human-oversight-required"
      ]
    },
    {
      "section": "B.2",
      "row": "transparency-disclosure-required",
      "rules": [
        "covenant:transparency-disclosure-required"
      ]
    },
    {
      "section": "B.2",
      "row": "ai-generated-content-marked",
      "rules": [
        "covenant:ai-generated-content-marked"
      ]
    },
    {
      "section": "B.2",
      "row": "explainable-ai-required",
      "rules": [
        "covenant:explainable-ai-required"
      ]
    },
    {
      "section": "B.2",
      "row": "interpretable-ai-required",
      "rules": [
        "covenant:interpretable-ai-required"
      ]
    },
    {
      "section": "B.2",
      "row": "fair-bias-managed-required",
      "rules": [
        "covenant:fair-bias-managed-required"
      ]
    },
    {
      "section": "B.2",
      "row": "right-of-erasure",
      "rules": [
        "covenant:right-of-erasure"
      ]
    },
    {
      "section": "B.2",
      "row": "right-of-access",
      "rules": [
        "covenant:right-of-access"
      ]
    },
    {
      "section": "B.2",
      "row": "right-of-portability",
      "rules": [
        "covenant:right-of-portability"
      ]
    },
    {
      "section": "B.2",
      "row": "ai-unacceptable-risk",
      "rules": [
        "class:ai-unacceptable-risk"
      ]
    },
    {
      "section": "B.2",
      "row": "ai-high-risk",
      "rules": [
        "class:ai-high-risk"
      ]
    },
    {
      "section": "B.3",
      "row": "audit-required",
      "rules": [
        "covenant:audit-required"
      ]
    },
    {
      "section": "B.3",
      "row": "encryption-required",
      "rules": [
        "covenant:encryption-required"
      ]
    },
    {
      "section": "B.3",
      "row": "encryption-in-use",
      "rules": [
        "covenant:encryption-in-use"
      ]
    },
    {
      "section": "B.3",
      "row": "hipaa",
      "rules": [
        "covenant:hipaa"
      ]
    },
    {
      "section": "B.3",
      "row": "gdpr",
      "rules": [
        "covenant:gdpr"
      ]
    },
    {
      "section": "B.3",
      "row": "42-cfr-part-2",
      "rules": [
        "covenant:42-cfr-part-2"
      ]
    },
    {
      "section": "B.3",
      "row": "gina",
      "rules": [
        "covenant:gina"
      ]
    },
    {
      "section": "B.3",
      "row": "role-based-access",
      "rules": [
        "covenant:role-based-access"
      ]
    },
    {
      "section": "B.3",
      "row": "mfa-required",
      "rules": [
        "covenant:mfa-required"
      ]
    },
    {
      "section": "B.3",
      "row": "redacted-display-only",
      "rules": [
        "covenant:redacted-display-only"
      ]
    },
    {
      "section": "B.3",
      "row": "summary-only-display",
      "rules": [
        "covenant:summary-only-display"
      ]
    },
    {
      "section": "B.3",
      "row": "role-restricted-display",
      "rules": [
        "covenant:role-restricted-display"
      ]
    },
    {
      "section": "B.3",
      "row": "audit-on-display",
      "rules": [
        "covenant:audit-on-display"
      ]
    },
    {
      "section": "B.3",
      "row": "subject-authorization-required",
      "rules": [
        "covenant:subject-authorization-required"
      ]
    },
    {
      "section": "B.3",
      "row": "agreement-required",
      "rules": [
        "covenant:agreement-required"
      ]
    },
    {
      "section": "B.3",
      "row": "agreement-required-baa",
      "rules": [
        "covenant:agreement-required-baa"
      ]
    },
    {
      "section": "B.3",
      "row": "agreement-required-dua",
      "rules": [
        "covenant:agreement-required-dua"
      ]
    },
    {
      "section": "B.3",
      "row": "agreement-required-mou",
      "rules": [
        "covenant:agreement-required-mou"
      ]
    },
    {
      "section": "B.3",
      "row": "organizational-policy-required",
      "rules": [
        "covenant:organizational-policy-required"
      ]
    },
    {
      "section": "B.3",
      "row": "consent-current-required",
      "rules": [
        "covenant:consent-current-required"
      ]
    },
    {
      "section": "B.3",
      "row": "parental-consent-required",
      "rules": [
        "covenant:parental-consent-required"
      ]
    },
    {
      "section": "B.3",
      "row": "professional-determination-required",
      "rules": [
        "covenant:professional-determination-required"
      ]
    },
    {
      "section": "B.3",
      "row": "de-identification-required",
      "rules": [
        "covenant:de-identification-required"
      ]
    },
    {
      "section": "B.3",
      "row": "delete-after-use",
      "rules": [
        "covenant:delete-after-use"
      ]
    },
    {
      "section": "B.3",
      "row": "no-disclosure-to-subject",
      "rules": [
        "covenant:no-disclosure-to-subject"
      ]
    },
    {
      "section": "B.3",
      "row": "within-jurisdiction-only",
      "rules": [
        "covenant:within-jurisdiction-only"
      ]
    },
    {
      "section": "B.3",
      "row": "no-collect",
      "rules": [
        "covenant:no-collect"
      ],
      "resolution": "Ingestion remains prohibited; transient-processing-only is not an exception."
    },
    {
      "section": "B.3",
      "row": "no-derived-collection",
      "rules": [
        "covenant:no-derived-collection"
      ]
    },
    {
      "section": "B.3",
      "row": "lawful-basis-consent",
      "rules": [
        "covenant:lawful-basis-consent"
      ]
    },
    {
      "section": "B.3",
      "row": "lawful-basis-contract",
      "rules": [
        "covenant:lawful-basis-contract"
      ]
    },
    {
      "section": "B.3",
      "row": "lawful-basis-legal-obligation",
      "rules": [
        "covenant:lawful-basis-legal-obligation"
      ]
    },
    {
      "section": "B.3",
      "row": "lawful-basis-public-task",
      "rules": [
        "covenant:lawful-basis-public-task"
      ]
    },
    {
      "section": "B.3",
      "row": "lawful-basis-legitimate-interests",
      "rules": [
        "covenant:lawful-basis-legitimate-interests"
      ]
    },
    {
      "section": "B.3",
      "row": "human-oversight-required",
      "rules": [
        "covenant:human-oversight-required"
      ]
    },
    {
      "section": "B.3",
      "row": "transparency-disclosure-required",
      "rules": [
        "covenant:transparency-disclosure-required"
      ]
    },
    {
      "section": "B.3",
      "row": "ai-generated-content-marked",
      "rules": [
        "covenant:ai-generated-content-marked"
      ]
    },
    {
      "section": "B.3",
      "row": "valid-and-reliable-required",
      "rules": [
        "covenant:valid-and-reliable-required"
      ]
    },
    {
      "section": "B.3",
      "row": "safe-ai-required",
      "rules": [
        "covenant:safe-ai-required"
      ]
    },
    {
      "section": "B.3",
      "row": "secure-resilient-ai-required",
      "rules": [
        "covenant:secure-resilient-ai-required"
      ]
    },
    {
      "section": "B.3",
      "row": "accountable-transparent-ai-required",
      "rules": [
        "covenant:accountable-transparent-ai-required"
      ]
    },
    {
      "section": "B.3",
      "row": "explainable-ai-required",
      "rules": [
        "covenant:explainable-ai-required"
      ]
    },
    {
      "section": "B.3",
      "row": "interpretable-ai-required",
      "rules": [
        "covenant:interpretable-ai-required"
      ]
    },
    {
      "section": "B.3",
      "row": "privacy-enhanced-ai-required",
      "rules": [
        "covenant:privacy-enhanced-ai-required"
      ]
    },
    {
      "section": "B.3",
      "row": "fair-bias-managed-required",
      "rules": [
        "covenant:fair-bias-managed-required"
      ]
    },
    {
      "section": "B.3",
      "row": "risk-management-system-required",
      "rules": [
        "covenant:risk-management-system-required"
      ]
    },
    {
      "section": "B.3",
      "row": "conformity-assessment-required",
      "rules": [
        "covenant:conformity-assessment-required"
      ]
    },
    {
      "section": "B.3",
      "row": "attribution-required",
      "rules": [
        "covenant:attribution-required"
      ]
    },
    {
      "section": "B.3",
      "row": "share-alike-required",
      "rules": [
        "covenant:share-alike-required"
      ]
    },
    {
      "section": "B.3",
      "row": "right-of-access",
      "rules": [
        "covenant:right-of-access"
      ]
    },
    {
      "section": "B.3",
      "row": "right-of-erasure",
      "rules": [
        "covenant:right-of-erasure"
      ]
    },
    {
      "section": "B.3",
      "row": "right-of-portability",
      "rules": [
        "covenant:right-of-portability"
      ]
    },
    {
      "section": "B.3",
      "row": "right-of-rectification",
      "rules": [
        "covenant:right-of-rectification"
      ]
    },
    {
      "section": "B.3",
      "row": "right-to-object",
      "rules": [
        "covenant:right-to-object"
      ]
    },
    {
      "section": "B.3",
      "row": "eu-ai-act",
      "rules": [
        "covenant:eu-ai-act"
      ]
    },
    {
      "section": "B.3",
      "row": "iso-iec-42001",
      "rules": [
        "covenant:iso-iec-42001"
      ]
    },
    {
      "section": "B.3",
      "row": "iso-iec-27001",
      "rules": [
        "covenant:iso-iec-27001"
      ]
    },
    {
      "section": "B.3",
      "row": "nist-ai-rmf",
      "rules": [
        "covenant:nist-ai-rmf"
      ]
    }
  ]
} as const;
export const enforcementData = {
  "profile": "PSP-TRUST-1.0",
  "version": "1.0",
  "status": "proposed-standard",
  "levels": [
    {
      "level": 0,
      "name": "platform"
    },
    {
      "level": 1,
      "name": "governance"
    },
    {
      "level": 2,
      "name": "session"
    },
    {
      "level": 3,
      "name": "context"
    },
    {
      "level": 4,
      "name": "user"
    },
    {
      "level": 5,
      "name": "external"
    }
  ],
  "unsignedDefaults": {
    "user": 4,
    "external": 5
  },
  "signatureDefaults": {
    "trustLevel": 2,
    "priority": 50
  },
  "topologyOrder": [
    "A",
    "B",
    "C"
  ],
  "minimumDeterministicTopology": "B",
  "requiredGates": {
    "A": [],
    "B": [
      "pre-inference",
      "tool-dispatch",
      "output-release",
      "policy-binding",
      "side-effects"
    ],
    "C": [
      "pre-inference",
      "tool-dispatch",
      "output-release",
      "policy-binding",
      "side-effects",
      "mcp-dispatch",
      "server-output"
    ]
  },
  "trustReasonCodes": [
    "UNAUTHORIZED_TRUST",
    "ENGINE_ISOLATION_UNSUPPORTED"
  ]
} as const;
