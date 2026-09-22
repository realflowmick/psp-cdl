# RFC-CDL

**Request for Comments: Covenant Declaration Language**

**Document Version:** 1.5  
**Date:** May 5, 2026  
**Status:** Proposed Standard  
**Authors:** RealflowCloud Engineering Team  
**Category:** Standards Track

---

## Document Abstract

This RFC defines the Covenant Declaration Language (CDL), a universal vocabulary for expressing data governance requirements that travel with data across system boundaries. CDL enables AI systems to understand and enforce data handling constraints through natural language declarations attached to JSON Schema at any hierarchical level. The specification addresses the critical enterprise requirement for "governance that travels with the data" through three declaration types: classifications (what data IS), covenants (what you MUST/MUST NOT do), and capabilities (what tools CAN do).

**Key Features:**
1. Natural language vocabulary for data governance
2. Hierarchical attachment to JSON Schema at any level
3. Support for both string and array declaration formats
4. Negation syntax for explicit covenant overrides
5. Multiple discovery patterns for maximum interoperability
6. Multi-topology enforcement model: deterministic policy decision points at AI infrastructure chokepoints (chat host, MCP proxy, MCP server) when present, with LLM semantic understanding as a defense-in-depth layer or as the sole enforcement mechanism in unproxied environments
7. Cryptographic signature support for trust validation
8. Unified vocabulary covering HL7 healthcare governance, W3C ODRL digital rights, W3C DPV privacy, OASIS XACML access control, EU AI Act risk classification, NIST AI RMF trustworthiness, ISO/IEC 42001/27001/27701 frameworks, Creative Commons content licensing, and C2PA content provenance

**Design Philosophy:**
CDL is a **declaration language**, not a protocol. There are no handshakes or negotiation phases. Declarations express governance requirements using vocabulary that is interpretable both by deterministic policy decision points (in proxied deployments) and by LLMs through semantic comprehension (in unproxied deployments or as a defense-in-depth layer). The vocabulary is designed to be understood at both layers without requiring separate encodings.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology and Conventions](#2-terminology-and-conventions)
3. [CDL Declaration Types](#3-cdl-declaration-types)
4. [Syntax and Format](#4-syntax-and-format)
5. [Capability Discovery Patterns](#5-capability-discovery-patterns)
6. [Hierarchical Attachment](#6-hierarchical-attachment)
7. [Covenant-Capability Matching and Enforcement Topologies](#7-covenant-capability-matching-and-enforcement-topologies)
8. [Standard Vocabulary](#8-standard-vocabulary)
9. [Signature and Trust](#9-signature-and-trust)
10. [Implementation Requirements](#10-implementation-requirements)
11. [RBAC Vocabulary](#11-rbac-vocabulary)
12. [Relationship to Existing Standards](#12-relationship-to-existing-standards)
13. [Security Considerations](#13-security-considerations)
14. [References](#14-references)
15. [Appendix A: Complete Examples](#appendix-a-complete-examples)
16. [Appendix B: CDL Vocabulary Reference](#appendix-b-cdl-vocabulary-reference)
17. [Appendix C: HL7 Term Mapping](#appendix-c-hl7-term-mapping)

---

## 1. Introduction

### 1.1 Purpose

This specification defines the Covenant Declaration Language (CDL), a universal vocabulary for expressing data governance requirements that travel with data. CDL enables AI systems to understand and enforce data handling constraints through a layered enforcement model: deterministic policy decision points at proxy tiers when present, and LLM semantic comprehension as a defense-in-depth layer or as the sole enforcement mechanism in unproxied deployments.

### 1.2 Problem Statement

Traditional data governance approaches fail when data crosses system boundaries:
- Policy engines cannot travel with data
- Governance metadata is lost in transit
- Compliance rules require complex synchronization
- AI systems lack visibility into data handling requirements
- No standard vocabulary for data covenants exists

CDL solves these problems by embedding governance declarations directly in JSON Schema using vocabulary that is interpretable both by deterministic policy decision points and by LLMs.

### 1.3 Design Goals

1. **Self-describing data**: Governance travels with the data payload
2. **Dual interpretability**: Deterministic policy decision points enforce covenants in proxied deployments; LLMs interpret the same vocabulary semantically in unproxied deployments
3. **Hierarchical flexibility**: Attach at any JSON Schema level
4. **Format flexibility**: Support both string and array formats
5. **Topology agnostic**: Works across deployment topologies, with enforcement guarantees that scale with the topology present
6. **Human readable**: Governance declarations are clear to humans, deterministic systems, and AI
7. **Cryptographically verifiable**: Signatures prove authenticity

### 1.4 Scope

This specification covers:
- Three declaration types: classes, covenants, capabilities
- Syntax for attaching declarations to JSON Schema
- Multiple discovery patterns for capability advertisement
- Hierarchical inheritance and negation semantics
- Standard vocabulary for common governance scenarios
- LLM-based covenant-capability matching

This specification does NOT cover:
- Network protocols or transport mechanisms
- Specific compliance framework implementations
- LLM implementation details
- Application-specific vocabularies (though extensible)

---

## 2. Terminology and Conventions

### 2.1 Requirement Levels

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

### 2.2 Key Terms

**CDL (Covenant Declaration Language)**: The vocabulary and syntax defined in this specification.

**Declaration**: A governance statement attached to data or tools using CDL syntax.

**Classification**: A category describing what data IS (e.g., PHI, PII, confidential).

**Covenant**: A constraint describing what you MUST or MUST NOT do with data (e.g., no-persist, no-training).

**Capability**: A statement describing what a tool or agent CAN do (e.g., can-send-email, logs-operations).

**Hierarchical Attachment**: The ability to attach CDL declarations at any level in a JSON Schema tree.

**Inheritance**: Child schema nodes inherit declarations from parent nodes unless negated.

**Negation**: The explicit removal of an inherited declaration using the `!` prefix.

**Semantic Understanding**: Comprehension of declaration meaning based on natural language and programming language semantics; performed by an LLM in Topology A and by a deterministic PDP using the matching tables in Appendix B in Topologies B and C.

**Covenant-Capability Matching**: The process by which an enforcement layer (deterministic PDP, LLM, or both in defense-in-depth) determines whether a tool's capabilities satisfy data covenant requirements.

---

## 3. CDL Declaration Types

CDL defines three distinct declaration types, each serving a specific governance purpose:

### 3.1 Classifications (`x-cdl-classes`)

**Purpose**: Declare what the data IS

**Scope**: Attached to data schemas (JSON Schema for inputs/outputs)

**Examples**: `phi`, `pii`, `pci`, `confidential`, `public`, `internal`

**Semantic Meaning**: Describes the inherent nature and sensitivity level of data

**Usage**:
```json
{
  "type": "object",
  "x-cdl-classes": "phi confidential"
}
```

### 3.2 Covenants (`x-cdl-covenants`)

**Purpose**: Declare what you MUST or MUST NOT do with data

**Scope**: Attached to data schemas (JSON Schema for inputs/outputs)

**Examples**: `no-persist`, `no-training`, `audit-required`, `encryption-required`, `hipaa`

**Semantic Meaning**: Constraints on data usage, retention, transmission, and processing

**Usage**:
```json
{
  "type": "object",
  "x-cdl-covenants": "no-persist no-training audit-required"
}
```

### 3.3 Capabilities (`x-cdl-capabilities`)

**Purpose**: Declare what a tool or agent CAN do

**Scope**: Attached to MCP tools, MCP servers, agents, or service descriptions

**Examples**: `can-send-email`, `can-write-storage`, `logs-operations`, `persists-data`

**Semantic Meaning**: The actual abilities and side effects of executing a tool or agent

**Usage**:
```json
{
  "name": "send_notification",
  "x-cdl-capabilities": "can-send-email can-call-external-api logs-operations"
}
```

### 3.4 Declaration Orthogonality

These three declaration types are **orthogonal and independent**:

- **Data** has `x-cdl-classes` and `x-cdl-covenants`
- **Tools/Agents** have `x-cdl-capabilities`
- **LLMs match** covenants against capabilities to enforce governance

---

## 4. Syntax and Format

### 4.1 Dual Format Support

CDL declarations MUST support both string and array formats:

**String Format** (space-separated):
```json
{
  "x-cdl-classes": "phi pii confidential",
  "x-cdl-covenants": "no-persist no-training audit-required",
  "x-cdl-capabilities": "can-send-email logs-operations"
}
```

**Array Format**:
```json
{
  "x-cdl-classes": ["phi", "pii", "confidential"],
  "x-cdl-covenants": ["no-persist", "no-training", "audit-required"],
  "x-cdl-capabilities": ["can-send-email", "logs-operations"]
}
```

### 4.2 Parsing Rules

Implementations MUST:
1. Accept both string and array formats for all declaration types
2. If string format: split on whitespace (space, tab, newline)
3. If array format: use elements directly
4. Treat both formats as semantically equivalent
5. Ignore empty strings and duplicate entries

### 4.3 Negation Syntax

The `!` prefix negates an inherited covenant:

```json
{
  "x-cdl-covenants": "no-persist no-training encryption-required",
  "properties": {
    "publicSummary": {
      "type": "string",
      "x-cdl-covenants": "!no-persist !encryption-required"
    }
  }
}
```

**Negation Rules**:
1. `!covenant-name` removes the specified covenant inherited from parent
2. Negation only affects inherited covenants (cannot negate own declarations)
3. Multiple negations allowed in single declaration
4. Works in both string and array formats: `"!no-persist"` or `["!no-persist"]`
5. LLMs understand `!` from programming language semantics (JavaScript, C/C++/Java)

### 4.4 Case Sensitivity

CDL declarations are **case-insensitive**. Implementations SHOULD normalize to lowercase:
- `PHI` = `phi` = `Phi`
- `No-Persist` = `no-persist` = `NO-PERSIST`

### 4.5 Delimiter Convention

Multi-word declarations use hyphens:
- `no-persist` (not `noPersist` or `no_persist`)
- `can-send-email` (not `canSendEmail` or `can_send_email`)
- `audit-required` (not `auditRequired` or `audit_required`)

This convention maximizes readability and consistency.

---

## 5. Capability Discovery Patterns

Agents, tools, and services declare capabilities through multiple mechanisms. Implementations SHOULD support all patterns for maximum interoperability.

### 5.1 MCP Tool-Level Declaration

Capabilities declared on individual MCP tools:

```json
{
  "tools": [
    {
      "name": "send_customer_notification",
      "description": "Sends email notification to customer",
      "x-cdl-capabilities": "can-send-email can-call-external-api logs-operations persists-data",
      "inputSchema": {
        "type": "object",
        "properties": {
          "recipient": {"type": "string"},
          "message": {"type": "string"}
        }
      }
    }
  ]
}
```

**Scope**: Applies only to this specific tool.

**Use Case**: Tool-specific capabilities that may differ from server defaults.

### 5.2 MCP Server-Level Declaration

Capabilities declared at the server level, inherited by all tools:

```json
{
  "serverInfo": {
    "name": "email-service",
    "version": "1.0.0",
    "x-cdl-capabilities": "can-send-email logs-operations persists-data"
  },
  "tools": [
    {
      "name": "send_email",
      "description": "Sends email"
    },
    {
      "name": "schedule_email",
      "description": "Schedules email for later"
    }
  ]
}
```

**Scope**: Default capabilities for all tools on this server unless tool-level declaration overrides.

**Use Case**: Common capabilities shared by all tools on a server.

### 5.3 Agent Manifest Declaration

Autonomous agents declare aggregated capabilities:

```json
{
  "agent": {
    "name": "customer-service-bot",
    "description": "Autonomous customer service agent",
    "version": "2.1.0",
    "x-cdl-capabilities": [
      "can-send-email",
      "can-send-sms",
      "can-write-storage",
      "can-call-external-api",
      "has-human-in-loop",
      "logs-operations",
      "persists-data"
    ]
  }
}
```

**Scope**: Complete capability set for the agent, typically the union of all tools it can invoke.

**Use Case**: Autonomous agents that orchestrate multiple tools and services.

### 5.4 Separate CDL Resource (Sidecar Pattern)

Capabilities available via dedicated resource endpoint:

**Single Endpoint for All Declarations**:
```
GET mcp://service-name/cdl

Response:
{
  "x-cdl-classes": "confidential pii",
  "x-cdl-covenants": "no-training audit-required encryption-required",
  "x-cdl-capabilities": "can-send-email can-call-external-api logs-operations persists-data",
  "signature": "ed25519:abc123...",
  "issued_at": "2025-11-12T10:00:00Z",
  "expires_at": "2026-11-12T10:00:00Z"
}
```

**Separate Endpoints by Type**:
```
GET mcp://service-name/cdl/classes
GET mcp://service-name/cdl/covenants
GET mcp://service-name/cdl/capabilities
```

**Scope**: Centralized governance declaration, can be cached and validated independently.

**Use Case**: 
- Governance managed separately from tool implementation
- Realflow.ai governance platform sidecar deployment
- Centralized compliance team control

### 5.5 Response-Time Declaration (Dynamic Capabilities)

Capabilities returned with actual response data:

```json
{
  "result": {
    "email_sent": true,
    "message_id": "abc123",
    "queued_at": "2025-11-12T10:00:00Z"
  },
  "x-cdl-capabilities": "can-send-email logs-operations persists-data",
  "x-cdl-covenants": "audit-required retention-90-days"
}
```

**Scope**: Declares what capabilities were actually exercised during this specific call.

**Use Case**:
- Dynamic capability determination based on runtime conditions
- Post-execution audit trail
- Compliance verification after the fact

### 5.6 API Gateway/Passthrough Injection

Capabilities injected by middleware layer (APIM, API Gateway, proxy):

**Request Header Injection**:
```http
POST /api/send-notification
X-CDL-Capabilities: can-send-email can-call-external-api logs-operations
X-CDL-Classes: confidential
X-CDL-Covenants: audit-required no-training
```

**Response Body Injection** (APIM policy adds to JSON):
```json
{
  "data": {
    "notification_sent": true
  },
  "x-cdl-capabilities": "can-send-email logs-operations persists-data"
}
```

**Scope**: Infrastructure layer declares capabilities/covenants on behalf of backend services.

**Use Case**:
- Legacy systems that don't natively support CDL
- Centralized governance enforcement at API gateway
- Azure APIM, AWS API Gateway, Kong, Apigee deployments

### 5.7 JSON Schema Output Declaration (Data-Bound Covenants)

Covenants and classes attached to JSON Schema for output data:

```json
{
  "name": "get_patient_record",
  "description": "Retrieves patient medical record",
  "outputSchema": {
    "type": "object",
    "x-cdl-classes": "phi confidential",
    "x-cdl-covenants": "hipaa no-persist no-training healthcare-staff-only",
    "properties": {
      "patientId": {
        "type": "string"
      },
      "diagnosis": {
        "type": "string",
        "x-cdl-classes": "phi",
        "x-cdl-covenants": "hipaa medical-staff-only"
      }
    }
  }
}
```

**Scope**: Governance bound to the data structure itself, travels with schema definition.

**Use Case**:
- MCP tool output schemas
- API response schemas
- Data contracts between services

---

### 5.8 Capability Inheritance and Aggregation Rules

**Inheritance Hierarchy**:
1. **Tool-level** declarations override Server-level
2. **Server-level** provides defaults for all tools
3. **Agent-level** = union of all tools the agent can invoke

**Transitive Capabilities Rule**:

If Tool A calls Tool B, and Tool B has `can-send-email`, then Tool A MUST declare `can-send-email` even if it doesn't directly send email.

**Example**:
```
generate_customer_report â†’ create_pdf â†’ email_delivery_service
                                         â””â”€ can-send-email

Therefore: generate_customer_report MUST declare "can-send-email"
```

**Rationale**: Governance enforcement requires visibility into all possible side effects, including transitive ones. An LLM routing PHI data to `generate_customer_report` must know that email transmission is possible in the execution chain.

**Discovery Priority** (when multiple sources exist):
1. Response-time declaration (most authoritative - actual behavior)
2. Tool-level declaration (specific to this tool)
3. Sidecar resource (externally managed governance)
4. Server-level declaration (default for all tools)
5. Agent manifest (aggregated capabilities)

**Conflict Resolution**:
- **Most permissive wins**: If any source declares a capability, that capability exists
- **Union of all sources**: Aggregate capabilities from all applicable discovery patterns
- **Explicit negation not supported for capabilities**: Tools cannot negate server-level capabilities (transitive rule prevents this)

---

## 6. Hierarchical Attachment

### 6.1 Attachment Points

CDL declarations can attach at any level in a JSON Schema hierarchy:

- **Root level**: Applies to entire schema
- **Object properties**: Applies to specific fields
- **Nested objects**: Applies to subtrees
- **Array items**: Applies to array elements (via schema definition)

### 6.2 Inheritance Semantics

**Rule**: Child schema nodes inherit all parent covenants and classes unless explicitly negated.

**Inheritance is additive**:
```json
{
  "type": "object",
  "x-cdl-classes": "confidential",
  "x-cdl-covenants": "no-training audit-required",
  "properties": {
    "fieldA": {
      "type": "string"
      // Inherits: confidential, no-training, audit-required
    },
    "fieldB": {
      "type": "string",
      "x-cdl-classes": "pii",
      "x-cdl-covenants": "encryption-required"
      // Has: confidential, pii, no-training, audit-required, encryption-required
    }
  }
}
```

### 6.3 Classification Override

Child classifications **extend** parent classifications (they accumulate):

```json
{
  "x-cdl-classes": "confidential",
  "properties": {
    "sensitiveField": {
      "type": "string",
      "x-cdl-classes": "pii phi"
      // Final: confidential, pii, phi
    }
  }
}
```

### 6.4 Covenant Negation

Use `!` prefix to remove inherited covenants:

```json
{
  "type": "object",
  "x-cdl-classes": "confidential",
  "x-cdl-covenants": "no-persist no-training encryption-required",
  "properties": {
    "publicSummary": {
      "type": "string",
      "x-cdl-classes": "public",
      "x-cdl-covenants": "!no-persist !encryption-required"
      // Inherits: no-training
      // Removes: no-persist, encryption-required
      // Final: no-training
    },
    "sensitiveData": {
      "type": "string"
      // Inherits all: no-persist, no-training, encryption-required
    }
  }
}
```

### 6.5 Complex Hierarchy Example

```json
{
  "type": "object",
  "x-cdl-classes": "educational-record",
  "x-cdl-covenants": "ferpa no-training audit-required",
  "properties": {
    "studentId": {
      "type": "string"
      // Inherits: educational-record, ferpa, no-training, audit-required
    },
    "studentName": {
      "type": "string",
      "x-cdl-classes": "pii"
      // Has: educational-record, pii, ferpa, no-training, audit-required
    },
    "grades": {
      "type": "object",
      "x-cdl-covenants": "parent-consent-required",
      "properties": {
        "math": {"type": "number"},
        "science": {"type": "number"}
        // Both inherit: educational-record, ferpa, no-training, audit-required, parent-consent-required
      }
    },
    "vaccinationStatus": {
      "type": "boolean",
      "x-cdl-classes": "phi",
      "x-cdl-covenants": "hipaa healthcare-staff-only no-persist"
      // Has: educational-record, phi, ferpa, hipaa, no-training, audit-required, healthcare-staff-only, no-persist
    },
    "publicAchievements": {
      "type": "array",
      "x-cdl-classes": "public",
      "x-cdl-covenants": "!ferpa !no-training",
      "items": {
        "type": "string"
      }
      // Has: educational-record, public, audit-required
      // Removed: ferpa, no-training
    }
  }
}
```

### 6.6 Inheritance Algorithm

Implementations MUST process inheritance as follows:

```
1. Start with empty set of classes and covenants
2. Walk up JSON Schema hierarchy from current node to root
3. For each ancestor node:
   a. Add all x-cdl-classes to class set (duplicates ignored)
   b. Add all x-cdl-covenants to covenant set (duplicates ignored)
4. Process current node's declarations:
   a. Add any new x-cdl-classes to class set
   b. Process x-cdl-covenants:
      - For items without ! prefix: add to covenant set
      - For items with ! prefix: remove from covenant set
5. Result is final class and covenant sets for this node
```

---

## 7. Covenant-Capability Matching and Enforcement Topologies

CDL declarations are evaluated through covenant-capability matching: each covenant attached to data is checked against the capabilities of any tool that would process that data. This evaluation can be performed deterministically by a policy decision point (PDP) at a proxy tier, or semantically by an LLM, or both in layered defense-in-depth. Sections 7.1 through 7.5 describe the matching model and semantics, which are common to all enforcement modes. Section 7.6 defines the three reference enforcement topologies and the guarantees each provides. Implementations choosing a topology MUST satisfy the matching semantics in 7.1–7.5; the enforcement layer determines who or what performs the evaluation.

### 7.1 Semantic Matching Model

CDL covenants and capabilities use natural language vocabulary that conveys semantic intent rather than encoding rigid identifier-equality rules. Whether evaluated by a deterministic PDP or by an LLM, a CDL implementation MUST recognize:

1. Natural language meaning of declaration terms
2. Programming language semantics (e.g., `!` negation from C/Java/JavaScript)
3. Domain knowledge (HIPAA, GDPR, ODRL, EU AI Act, NIST AI RMF, and other frameworks referenced by CDL vocabulary)
4. Implication and entailment relationships between declarations

In Topology A (Section 7.6.1), an LLM performs this interpretation directly using its training. In Topologies B and C (Sections 7.6.2 and 7.6.3), a deterministic PDP performs the same logical evaluation using lookup tables, rule sets, or compiled matching code derived from the vocabulary in Sections 8 and Appendix B. The matrices in Appendix B are the normative source for deterministic implementations.

**Example implications that any conformant evaluator MUST recognize**:
- `logs-operations` implies `persists-data`
- `can-send-email` conflicts with `no-external-transmission`
- `phi` + `can-write-storage` conflicts with `no-persist`
- `audit-required` is satisfied by `logs-operations`

### 7.2 Matching Algorithm (High Level)

```
1. LLM receives data with covenants attached via x-cdl-covenants
2. LLM enumerates available tools/agents
3. For each tool:
   a. Retrieve capabilities via discovery patterns (Section 5)
   b. Apply inheritance and aggregation rules
   c. Build complete capability set
4. For each covenant in data:
   a. Determine if any tool capability conflicts with covenant
   b. Use semantic understanding to detect conflicts
5. Filter tools to only those with no covenant violations
6. If no compliant tools available:
   - Refuse request
   - Explain covenant violations
   - Suggest alternatives if possible
7. Route to compliant tool(s)
```

### 7.3 Common Conflict Patterns

| Data Covenant | Conflicting Capability | Rationale |
|---------------|------------------------|-----------|
| `no-persist` | `can-write-storage`, `logs-operations`, `persists-data` | Data would be stored |
| `no-training` | `used-for-model-training` | Data would train models |
| `no-external-transmission` | `can-send-email`, `can-send-sms`, `can-call-external-api` | Data leaves system boundary |
| `phi` + `no-persist` | `logs-operations` | Logs persist PHI |
| `encryption-required` | (capability absence check) | Tool must support encryption |
| `audit-required` | (capability requirement) | Tool must have `logs-operations` |

### 7.4 Semantic Understanding Examples

**Example 1: Transitive Understanding**

```
Data Covenant: "no-external-transmission phi"
Tool Capabilities: "can-generate-report can-write-storage"

LLM Reasoning:
- can-write-storage does NOT transmit externally
- can-generate-report is internal processing
- No conflict detected
- Tool is compliant
```

**Example 2: Implicit Conflict**

```
Data Covenant: "no-persist"
Tool Capabilities: "can-create-audit-trail logs-operations"

LLM Reasoning:
- logs-operations implies data persistence (logs are stored)
- can-create-audit-trail also implies persistence
- Conflict: no-persist violated by logging
- Tool is NOT compliant
```

**Example 3: Requirement Satisfaction**

```
Data Covenant: "audit-required encryption-required"
Tool Capabilities: "logs-operations encrypts-at-rest encrypts-in-transit"

LLM Reasoning:
- audit-required satisfied by logs-operations
- encryption-required satisfied by encrypts-at-rest and encrypts-in-transit
- All requirements met
- Tool is compliant
```

**Example 4: Operator Visibility Enforcement** (NEW in v1.1)

```
Data Covenant: "no-display-to-operator phi"
Tool Capabilities: "can-display-to-operator displays-raw-data"

LLM Reasoning:
- Data has no-display-to-operator covenant
- Tool has can-display-to-operator capability
- This is a chat/interface tool that shows output to operator
- Conflict: Tool would display PHI data to operator
- Tool is NOT compliant for operator display
- However: LLM can still process this data internally
- Action: Process data, provide conclusions, but filter raw data from output

Operator sees: "Lab results indicate elevated markers consistent with 
               diabetes. Recommend endocrinology referral."
Operator does NOT see: "HbA1c: 8.2%, Fasting glucose: 180 mg/dL"
```

**Example 5: Redacted Display Allowance** (NEW in v1.1)

```
Data Covenant: "redacted-display-only pii"
Tool Capabilities: "can-display-to-operator supports-redaction"

LLM Reasoning:
- Data requires redacted display only
- Tool supports redaction capability
- Tool can display, but must apply redaction rules
- Tool is compliant with redaction requirement
- Action: Apply redaction rules before display

Operator sees: "Customer SSN: ***-**-6789, Account: ****1234"
Operator does NOT see: "Customer SSN: 123-45-6789, Account: 98761234"
```

**Example 6: Role-Based Display Check** (NEW in v1.1)

```
Data Covenant: "role-restricted-display physician-only"
Operator Role: "physician_assistant"
Tool Capabilities: "can-display-to-operator checks-operator-role"

LLM Reasoning:
- Data restricted to physician-only display
- Current operator is physician_assistant
- Tool has checks-operator-role capability (can enforce)
- Role mismatch: physician_assistant ≠ physician
- Conflict: Operator lacks required role
- Tool is NOT compliant for this operator
- Action: Process data, provide summary, redact details

Operator sees: "Patient has cardiac history requiring physician review.
               Please consult with attending physician."
Operator does NOT see: Full cardiac history details
```

**Example 7: Complex Multi-Covenant**

```
Data Covenant: "phi hipaa no-training no-external-transmission healthcare-staff-only"
Tool Capabilities: "can-process-phi logs-operations encrypts-at-rest role-based-access"

LLM Reasoning:
- can-process-phi indicates PHI handling support
- logs-operations provides audit trail (HIPAA requirement)
- encrypts-at-rest supports data protection
- role-based-access can enforce healthcare-staff-only
- No external transmission capabilities present
- No training capabilities present
- Tool is compliant
```

### 7.5 Conflict Resolution Strategies

When covenant violations detected:

**1. Refuse and Explain**:
```
"I cannot use the send_email tool with this patient data because:
- Data has covenant: no-external-transmission
- Tool has capability: can-send-email
- This would violate HIPAA data transmission rules"
```

**2. Suggest Alternatives**:
```
"Instead of emailing this PHI data, I can:
- Store it in the secure internal system (compliant tool)
- Generate a secure link for authorized access
- Create a redacted summary for email transmission"
```

**3. Request Human Approval**:
```
"This action requires human authorization because:
- Data is classified as PHI with HIPAA covenants
- Requested tool can-send-email (external transmission)
- Do you authorize this exception? [Yes/No]"
```

**4. Automatic Redaction/Transformation**:
```
"I'll redact sensitive fields before using this tool:
- Removing: SSN, date-of-birth, diagnosis
- Keeping: aggregate statistics only
- This satisfies the no-phi-external-transmission covenant"
```

### 7.6 Enforcement Topologies

CDL supports a spectrum of enforcement topologies, ranging from semantic-only enforcement by the inference engine to multi-layer deterministic enforcement at AI infrastructure chokepoints. The same CDL declarations are valid across all topologies; the strength of enforcement guarantees depends on the topology in which CDL is deployed.

This section defines three reference topologies and the enforcement guarantees each provides.

#### 7.6.1 Topology A: Direct LLM (Unproxied)

**Deployment scenario**: A CDL-bearing artifact (e.g., a `.pspx` file or a JSON Schema with `x-cdl-*` declarations) is presented directly to an inference engine with no intermediary infrastructure between the user and the model. Examples include dragging a file onto a desktop AI client, pasting CDL-annotated content into a chat interface, or invoking the model API directly without a policy-aware proxy.

**Enforcement mechanism**: LLM semantic covenant-capability matching as described in Sections 7.1–7.5. The model interprets covenants and capabilities, applies inheritance and negation, and selects compliant tools.

**Enforcement guarantees**: Best-effort. Enforcement depends entirely on model compliance. The model MAY decline to invoke a tool whose capabilities conflict with declared covenants, but no infrastructure layer exists to deterministically prevent such invocations if the model fails to honor a covenant (e.g., due to prompt injection, instruction following failure, or model fine-tune drift).

**Appropriate use cases**: Personal productivity, exploratory analysis, experimentation, low-stakes workflows where the cost of a covenant violation is low and the convenience of unproxied operation is high.

**Limitations**: MUST NOT be relied upon for regulated data, contractually constrained data, or any scenario where deterministic enforcement is required by policy or law.

#### 7.6.2 Topology B: Chat-Host Proxied

**Deployment scenario**: A policy-aware chat host sits between the user and the inference engine. The chat host is the sole authority for prompt construction, tool dispatch, and response handling. All LLM API calls and tool invocations flow through the chat host.

**Enforcement mechanism**: Two layers.

1. **Deterministic enforcement (chat host)**: Before any tool call is dispatched, the chat host evaluates the covenants attached to data in the context against the capabilities declared by the requested tool. Conflicting tool calls are refused at the chat host before the tool ever executes. This evaluation is performed by deterministic code, not by the LLM.

2. **Semantic enforcement (LLM)**: The LLM additionally performs semantic matching as in Topology A, providing defense-in-depth.

**Enforcement guarantees**: Strong for tool dispatch. A tool whose declared capabilities conflict with declared covenants cannot be invoked, regardless of model behavior. The chat host MAY also enforce covenant requirements on prompt construction (e.g., refusing to include `no-external-transmission` data in prompts sent to a model hosted outside the data's permitted jurisdiction).

**Appropriate use cases**: Enterprise productivity tools, regulated workflows, scenarios requiring auditable enforcement decisions.

#### 7.6.3 Topology C: Full Proxy Chain

**Deployment scenario**: A chat host, an MCP proxy, and CDL-aware MCP servers are all present in the data path. The chat host mediates user/LLM interaction. The MCP proxy mediates LLM/tool interaction. The MCP servers themselves enforce covenants on the data they return.

**Enforcement mechanism**: Four layers.

1. **MCP server enforcement**: Tools enforce covenants on their own outputs. A tool returning `phi`-classified data MAY apply redaction, masking, or summarization before the data leaves the tool boundary, in compliance with declared covenants such as `redacted-display-only` or `summary-only-display`.

2. **MCP proxy enforcement**: The proxy enforces the active node's `agents` allow-list (zero-trust tool access per RFC-PSP-CORE) and additionally evaluates covenant-capability conflicts before forwarding any tool invocation. Tool calls failing either check are refused at the proxy.

3. **Chat host enforcement**: As described in Topology B.

4. **LLM semantic enforcement**: As described in Topology A.

**Enforcement guarantees**: Defense in depth. A covenant violation requires concurrent failure of at least two independent layers (MCP server, MCP proxy, chat host) plus the LLM, each implemented by separate deterministic code paths. This provides enforcement guarantees comparable to or stronger than traditional XACML-based PDP architectures, with the added benefit that PDPs sit on the AI inference path rather than only on REST API ingress.

**Appropriate use cases**: Healthcare, financial services, government, legal, and other regulated environments. Multi-tenant SaaS platforms processing third-party data under contractual covenants. Any deployment where covenant violations carry regulatory, legal, or contractual consequences.

#### 7.6.4 Topology Selection Guidance

Selection of an enforcement topology is a deployment decision, not a CDL specification decision. The same CDL declarations are valid across all three topologies; only the strength of enforcement varies.

Implementations SHOULD document which topology they provide. Data publishers MAY refuse to release CDL-bearing data to consumers whose declared topology does not meet the publisher's requirements. The CDL signature mechanism (Section 9) enables data publishers to bind covenant requirements cryptographically, making downgrade attacks (e.g., stripping covenants to enable processing in a weaker topology) detectable.

#### 7.6.5 Graceful Degradation

CDL declarations are designed to degrade gracefully across topologies. A `.pspx` file authored for Topology C deployment remains usable in Topology A; the consumer simply receives weaker enforcement guarantees. This property is intentional: it allows CDL-annotated data to flow across organizational and infrastructure boundaries without requiring uniform deployment of the strongest topology.

Data publishers concerned about downgrade SHOULD use the signature mechanism (Section 9) to bind covenant requirements and SHOULD use the `enforcement-topology-required` covenant (when defined by extension vocabulary) to declare a minimum acceptable topology.

---

## 8. Standard Vocabulary

### 8.1 Design Philosophy

CDL vocabulary is **intentionally not exhaustive**. The specification provides common terms for widespread scenarios, but implementations are encouraged to extend vocabulary as needed. LLMs understand new terms through semantic comprehension.

### 8.2 Data Classifications (`x-cdl-classes`)

**Sensitivity Levels** (aligned with HL7 Confidentiality six-level total-order hierarchy):
- `public` - Publicly available information (HL7: U, Unrestricted)
- `low` - De-identified or limited data set; minimal residual reidentification risk (HL7: L, Low) [v1.3]
- `internal` - Internal organizational use only; authorized disclosure outside normative healthcare context (HL7: M, Moderate)
- `normal` - Default protection level for regulated healthcare data (HL7: N, Normal — e.g., HIPAA PHI baseline) [v1.3]
- `confidential` - Confidential business information
- `restricted` - Higher protection than normative (HL7: R, Restricted — e.g., behavioral health, HIV, substance use)
- `secret` - Highest protection level (HL7: V, Very Restricted — e.g., legal hold, attorney-client, trade secrets)

The six levels `public`, `low`, `internal`/`normal`, `restricted`, `secret` form a total-order hierarchy. Implementations MAY use either `internal` or `normal` (or both) depending on whether the deployment context is general business (`internal`) or healthcare/regulated (`normal`).

**Regulatory Categories**:
- `pii` - Personally Identifiable Information
- `phi` - Protected Health Information (HIPAA)
- `pci` - Payment Card Information (PCI-DSS)
- `financial` - Financial/banking data
- `credentials` - Authentication credentials, passwords, keys

**Clinical Sensitivity Categories** (aligned with HL7 InformationSensitivityPolicy) [v1.3]:

These categories enable jurisdiction-specific protection levels to be applied to specific kinds of sensitive information. In many U.S. and international jurisdictions, the categories below are subject to higher protection than baseline PHI under HIPAA.

- `psychiatric-information` - Mental health, psychiatric, or behavioral health records
- `substance-use-information` - Substance abuse treatment information (subject to 42 CFR Part 2 in the US)
- `hiv-information` - HIV/AIDS status and related testing/treatment information
- `genetic-information` - Genetic test results, family history, genetic disease markers (subject to GINA in the US)
- `reproductive-health-information` - Reproductive health, contraception, abortion-related information
- `sexual-violence-information` - Information related to sexual or domestic violence
- `minor-health-information` - Healthcare records for minors with jurisdiction-specific consent rules
- `developmental-disability-information` - Developmental disability diagnoses and treatment
- `social-services-information` - Information from social services involvement
- `taboo-information` - Culturally or jurisdictionally taboo information requiring patient-mediated disclosure

**Domain-Specific**:
- `educational-record` - Student records (FERPA)
- `employment-record` - Employee data
- `legal-privileged` - Attorney-client privileged
- `export-controlled` - ITAR/EAR restricted
- `directory-information` - Information appearing in directory listings (e.g., hospital patient directory) [v1.3]

**Geographic/Jurisdictional**:
- `gdpr-subject` - EU GDPR applies
- `ccpa-subject` - California CCPA applies
- `coppa-subject` - Children's data (COPPA)

**AI System Risk Classifications** (aligned with EU AI Act risk tiers) [v1.4]:

These classifications describe the risk tier of AI processing applied to the data, not the data itself. They trigger AI-Act-specific obligations under Section 8.3.

- `ai-unacceptable-risk` - AI processing prohibited under EU AI Act Article 5 (e.g., social scoring, subliminal manipulation, real-time public biometric ID with limited exceptions)
- `ai-high-risk` - AI processing falls under EU AI Act high-risk category (Annex III: biometric ID, critical infrastructure, education, employment, essential services, law enforcement, migration, justice administration)
- `ai-limited-risk` - AI processing falls under EU AI Act limited-risk transparency obligations (chatbots, deepfakes, generative AI output)
- `ai-minimal-risk` - AI processing falls under EU AI Act minimal-risk category (no mandatory obligations)
- `ai-gpai-model` - General-Purpose AI model under EU AI Act
- `ai-gpai-systemic-risk` - GPAI model with systemic risk designation under EU AI Act

**Generated/Synthetic Content** [v1.4]:
- `ai-generated` - Content generated by an AI system
- `ai-assisted` - Content created with AI assistance
- `synthetic-media` - Synthetic audio, image, video, or text
- `deepfake` - Synthetic media depicting real persons or events

### 8.3 Data Covenants (`x-cdl-covenants`)

**Storage and Persistence**:
- `no-persist` - Do not store or persist data
- `no-cache` - Do not cache data
- `no-log` - Do not write to logs
- `retention-{n}-days` - Delete after n days (e.g., `retention-90-days`)
- `ephemeral` - Delete immediately after use
- `delete-after-use` - Delete after first complete read by recipient (HL7 DELAU semantics) [v1.3]

**Collection Control** [v1.3]:
- `no-collect` - Prohibition on collection of this data; data MUST NOT be ingested or recorded by the receiving system
- `no-derived-collection` - Prohibition on collection of derived data, summaries, or extracts; processing MAY occur but MUST be ephemeral
- `collection-purpose-limited` - Collection is permitted only for the purposes declared via `purpose-{specific}` covenants

**Transmission and Export**:
- `no-external-transmission` - Do not send outside system boundary
- `no-export` - Do not export or download
- `no-copy` - Do not copy or duplicate
- `encrypted-transmission-required` - Encrypt during transmission
- `within-jurisdiction-only` - Keep within specific geography
- `no-government-disclosure` - Prohibition on disclosure to government entities except under explicit legal compulsion (HL7 NOGOV semantics) [v1.3]
- `no-directory-listing` - Prohibition on inclusion in directory listings, indexes, or registries (HL7 NOLIST semantics) [v1.3]
- `no-disclosure-to-subject` - Prohibition on disclosing the data to the data subject themselves; applies in scenarios such as test results pending professional interpretation, third-party-provided information requiring source review, or information the data subject's clinician has determined would cause harm if disclosed prematurely (HL7 NOPAT semantics) [v1.3]

**Training and Learning**:
- `no-training` - Do not use for model training
- `no-fine-tuning` - Do not use for model fine-tuning
- `no-learning` - Do not use for any learning/improvement
- `no-embedding-storage` - Do not store derived embeddings or vector representations [v1.3]
- `no-rag-indexing` - Do not index for retrieval-augmented generation [v1.3]

**Authorization Requirements** [v1.3]:

These covenants require specific authorization conditions to be satisfied before processing. They are distinct from `role-based-access` (which restricts based on operator role) in that they require evidence of an authorization decision external to the operator's role assignment.

- `subject-authorization-required` - Disclosure or processing requires explicit, current authorization from the data subject (HL7 NOAUTH semantics). Authorization MUST be verifiable and SHOULD be recorded with the processing event.
- `agreement-required` - Processing requires an active out-of-band agreement (data use agreement, business associate agreement, memorandum of understanding) on file between the data custodian and the receiving party (HL7 NOMOU semantics)
- `agreement-required-{type}` - Processing requires a specific type of agreement (e.g., `agreement-required-baa`, `agreement-required-dua`, `agreement-required-mou`)
- `organizational-policy-required` - Processing requires attestation of an organizational policy authorizing the use (HL7 NOORGPOL semantics)
- `consent-current-required` - Authorization MUST have been granted within a configured recency window; stale consents are insufficient
- `parental-consent-required` - Processing of minor's data requires verifiable parental or guardian consent
- `professional-determination-required` - Processing requires a credentialed professional (clinician, attorney, etc.) to authorize the specific use

**Legal Basis Declaration** (aligned with W3C DPV and GDPR Article 6) [v1.4]:

These covenants declare the legal basis under which processing is permitted. Implementations evaluating these covenants MUST verify the declared basis is satisfied before processing. Multiple legal bases may be declared; processing requires at least one to be active.

- `lawful-basis-consent` - Processing requires data subject consent (GDPR Article 6(1)(a))
- `lawful-basis-contract` - Processing necessary for performance of a contract with the data subject (GDPR Article 6(1)(b))
- `lawful-basis-legal-obligation` - Processing necessary for compliance with a legal obligation (GDPR Article 6(1)(c))
- `lawful-basis-vital-interests` - Processing necessary to protect vital interests (GDPR Article 6(1)(d))
- `lawful-basis-public-task` - Processing necessary for a task in the public interest or official authority (GDPR Article 6(1)(e))
- `lawful-basis-legitimate-interests` - Processing necessary for legitimate interests pursued by the controller or third party (GDPR Article 6(1)(f))
- `lawful-basis-explicit-consent` - Processing of special category data requires explicit consent (GDPR Article 9(2)(a))
- `lawful-basis-substantial-public-interest` - Processing of special category data for substantial public interest (GDPR Article 9(2)(g))
- `lawful-basis-{custom}` - Domain-specific legal basis (e.g., `lawful-basis-research-ethics-board`)

**Purpose Limitation** (extending v1.0 with DPV-aligned purposes) [v1.4]:

CDL v1.0 introduced `purpose-{specific}` as an extensible pattern. v1.4 standardizes common purpose values aligned with the W3C Data Privacy Vocabulary purpose taxonomy.

- `purpose-service-provision` - Direct service delivery to data subject
- `purpose-personalization` - Personalizing user experience
- `purpose-marketing` - Marketing and advertising
- `purpose-research` - Research and statistical analysis
- `purpose-research-medical` - Medical research specifically
- `purpose-fraud-prevention` - Fraud and abuse prevention
- `purpose-security` - Information security and threat detection
- `purpose-compliance` - Regulatory compliance and reporting
- `purpose-quality-improvement` - Service quality improvement
- `purpose-public-health` - Public health activities
- `purpose-treatment` - Direct medical treatment
- `purpose-payment` - Healthcare payment and billing
- `purpose-healthcare-operations` - Healthcare operations under HIPAA

**ODRL-Aligned Prohibited Actions** [v1.4]:

These covenants prohibit specific actions on the data, drawing from the W3C ODRL action vocabulary. They are useful for digital content, document, and dataset governance scenarios.

- `no-derive` - Do not create derivative works
- `no-aggregate` - Do not include in aggregated datasets
- `no-extract` - Do not extract portions or excerpts
- `no-index` - Do not include in search indexes
- `no-distribute` - Do not distribute to third parties
- `no-share` - Do not share with other parties
- `no-modify` - Do not modify or alter
- `no-transform` - Do not transform format or representation
- `no-translate` - Do not translate to other languages
- `no-print` - Do not print or render to physical media
- `no-display` - Do not display in user interfaces
- `no-execute` - Do not execute as code or instructions
- `no-commercial-use` - Do not use for commercial purposes
- `no-secondary-use` - Do not use beyond the original purpose
- `no-resale` - Do not sell or resell
- `no-sublicense` - Do not grant sublicenses
- `no-watermark-removal` - Do not remove watermarks or attribution

**Required Actions and Attribution** (aligned with ODRL and Creative Commons) [v1.4]:
- `attribution-required` - Attribution to original author/source required
- `share-alike-required` - Derivative works must be released under same terms
- `notify-on-use` - Notify designated party when processed
- `inform-of-recipients` - Disclose downstream recipients
- `obtain-consent-each-use` - Obtain consent for each individual use
- `pay-required` - Payment required before use
- `review-before-publish` - Human review required before publication

**AI Trustworthiness Requirements** (aligned with NIST AI RMF and EU AI Act) [v1.4]:

These covenants declare AI-specific trustworthiness requirements that any AI processing of the data must satisfy. Drawn from NIST AI RMF 1.0 trustworthiness characteristics and EU AI Act high-risk system requirements.

- `valid-and-reliable-required` - AI processing must demonstrate validity and reliability
- `safe-ai-required` - AI processing must operate without imposing physical, life, or property risks
- `secure-resilient-ai-required` - AI processing must be resilient to adversarial inputs and cyber threats
- `accountable-transparent-ai-required` - AI processing must support accountability and transparency
- `explainable-ai-required` - AI processing must produce explainable outputs ("how" was decided)
- `interpretable-ai-required` - AI processing must produce interpretable outputs ("why" was decided)
- `privacy-enhanced-ai-required` - AI processing must use privacy-enhancing techniques
- `fair-bias-managed-required` - AI processing must demonstrate harmful bias has been managed
- `human-oversight-required` - AI processing must include human oversight (EU AI Act Article 14)
- `transparency-disclosure-required` - Recipients must be informed they are interacting with AI (EU AI Act limited-risk obligation)
- `ai-generated-content-marked` - AI-generated outputs must be marked as such (EU AI Act GPAI obligation)
- `risk-management-system-required` - Processing requires documented risk management system (EU AI Act Article 9)
- `conformity-assessment-required` - Processing requires conformity assessment per EU AI Act Article 43
- `fundamental-rights-impact-assessed` - Fundamental Rights Impact Assessment completed (EU AI Act Article 27)

**Data Subject Rights** (aligned with GDPR Chapter III and DPV) [v1.4]:

These covenants declare data subject rights that processors MUST honor.

- `right-of-access` - Data subject has right to access their data
- `right-of-rectification` - Data subject can correct inaccurate data
- `right-of-erasure` - Data subject can request deletion ("right to be forgotten")
- `right-of-portability` - Data subject can receive data in portable format
- `right-of-restriction` - Data subject can restrict processing
- `right-to-object` - Data subject can object to processing
- `right-not-to-be-subject-to-automated-decisions` - GDPR Article 22 right re: solely automated decisions
- `right-to-explanation` - Data subject entitled to explanation of automated decisions

**Tracking and Profiling** [v1.4]:
- `no-tracking` - Do not track usage or behavior
- `no-profiling` - Do not build behavioral profiles
- `no-automated-decision-making` - Do not use for solely automated decisions producing legal or significant effects (GDPR Article 22)
- `accept-tracking-consent-required` - Tracking only with explicit consent (ODRL acceptTracking)

**Access Control**:
- `role-based-access` - Enforce role-based permissions
- `{role}-only` - Restrict to specific role (e.g., `healthcare-staff-only`, `finance-team-only`)
- `mfa-required` - Multi-factor authentication required
- `privileged-access-only` - Elevated permissions required

**Operator Visibility** (NEW in v1.1):
- `no-display-to-operator` - LLM can process but must not show data to current operator
- `operator-blind-processing` - LLM processes data that operator cannot see
- `redacted-display-only` - Show only masked/redacted version to operator
- `summary-only-display` - Show only summaries or conclusions, not raw data
- `role-restricted-display` - Display only if operator has required role
- `audit-on-display` - Log all display events to operator

**Rationale for Operator Visibility Covenants:**
These covenants enable AI systems to act as trusted intermediaries, processing sensitive data that human operators are not authorized to view directly. The LLM can analyze data, draw conclusions, and provide recommendations while protecting operator-level access controls. This is critical for scenarios where processing authority differs from viewing authority (e.g., physician assistant requesting diagnosis based on full patient records they cannot access, junior analyst getting insights from executive financial data, contractor receiving guidance without seeing confidential strategy).

**Rationale for `no-disclosure-to-subject`:**
This covenant covers scenarios where the data subject themselves must be excluded from access, distinct from operator-visibility covenants which exclude the operator. Common cases include: (1) lab results pending physician interpretation where premature disclosure could cause unnecessary patient distress, (2) third-party-provided information (e.g., from family members, employers, or law enforcement) where the source has a legitimate confidentiality interest, (3) information a treating clinician has documented as harmful to disclose without preparation, and (4) records subject to ongoing investigation where subject access would compromise the investigation. This covenant is widely used in HL7 deployments via the NOPAT code and is essential for clinical and legal AI workflows.

**Compliance and Audit**:
- `audit-required` - Log all access and operations
- `audit-trail-mandatory` - Maintain complete audit trail
- `compliance-review-required` - Requires compliance review
- `legal-hold` - Subject to legal hold, do not delete

**Regulatory Frameworks**:
- `hipaa` - HIPAA regulations apply
- `gdpr` - GDPR regulations apply
- `pci-dss` - PCI-DSS standards apply
- `sox` - Sarbanes-Oxley applies
- `ferpa` - FERPA regulations apply
- `fedramp` - FedRAMP compliance required
- `42-cfr-part-2` - 42 CFR Part 2 (US substance use treatment confidentiality) applies [v1.3]
- `gina` - Genetic Information Nondiscrimination Act applies [v1.3]
- `title-38-section-7332` - US Veterans Affairs sensitive information protections apply [v1.3]
- `eu-ai-act` - EU Artificial Intelligence Act applies [v1.4]
- `iso-iec-42001` - ISO/IEC 42001 AI management system standard applies [v1.4]
- `iso-iec-27001` - ISO/IEC 27001 information security management standard applies [v1.4]
- `iso-iec-27701` - ISO/IEC 27701 privacy information management standard applies [v1.4]
- `nist-ai-rmf` - NIST AI Risk Management Framework applies [v1.4]
- `nist-csf` - NIST Cybersecurity Framework applies [v1.4]
- `nist-800-53` - NIST SP 800-53 security and privacy controls apply [v1.4]
- `glba` - Gramm-Leach-Bliley Act (US financial privacy) applies [v1.4]
- `dpa-uk` - UK Data Protection Act applies [v1.4]
- `lgpd` - Brazil LGPD applies [v1.4]
- `pipeda` - Canada PIPEDA applies [v1.4]
- `appi` - Japan APPI applies [v1.4]
- `pdpa-singapore` - Singapore PDPA applies [v1.4]
- `pipl` - China PIPL applies [v1.4]

**Data Handling**:
- `encryption-required` - Encrypt at rest and in transit
- `encryption-at-rest` - Encrypt stored data
- `encryption-in-transit` - Encrypt during transmission
- `encryption-in-use` - Encrypt during processing (in-memory encryption, secure enclaves, or homomorphic encryption) (HL7 ENCRYPTU semantics) [v1.3]
- `redaction-required` - Redact before external use
- `anonymization-required` - Anonymize before sharing
- `de-identification-required` - Apply formal de-identification methodology (HIPAA Safe Harbor or Expert Determination, equivalent jurisdictional standards) before sharing; distinct from `anonymization-required` in that de-identification follows a regulated, auditable process (HL7 DEID semantics) [v1.3]
- `aggregation-required` - Aggregate before presentation
- `minimum-cohort-{n}` - Minimum cohort size n (e.g., `minimum-cohort-10`)

**Reidentification**:
- `no-reidentification` - Do not attempt to reidentify
- `no-linkage` - Do not link with other datasets
- `de-identified` - Data is de-identified

**Purpose Limitation**:
- `purpose-{specific}` - Limit to specific purpose (e.g., `purpose-medical-treatment`, `purpose-billing-only`)
- `original-purpose-only` - Use only for original collection purpose

**Expiration**:
- `expires-{datetime}` - Data expires at specific time (e.g., `expires-2025-12-31`)
- `session-only` - Valid only for current session
- `single-use` - Use once then delete

### 8.4 Agent/Tool Capabilities (`x-cdl-capabilities`)

**Data Transmission**:
- `can-send-email` - Can send email
- `can-send-sms` - Can send SMS/text messages
- `can-call-external-api` - Can call external APIs
- `can-post-to-web` - Can post to websites
- `can-transmit-externally` - Can send data outside system

**Data Storage**:
- `can-write-storage` - Can write to persistent storage
- `can-write-database` - Can write to database
- `can-write-filesystem` - Can write to filesystem
- `persists-data` - Data persists after execution
- `can-cache` - Can cache data

**Logging and Audit**:
- `logs-operations` - Logs all operations
- `logs-data` - Logs actual data values
- `creates-audit-trail` - Creates audit trail
- `no-logging` - Does not log anything

**Processing and Compute**:
- `can-process-phi` - Can handle PHI data
- `can-process-pii` - Can handle PII data
- `can-process-pci` - Can handle PCI data
- `processes-in-memory-only` - Only uses memory, no persistence
- `can-aggregate` - Can aggregate data
- `can-anonymize` - Can anonymize data
- `can-de-identify` - Can perform formal de-identification per HIPAA Safe Harbor or Expert Determination methodology [v1.3]
- `can-encrypt` - Can encrypt data
- `encrypts-at-rest` - Encrypts stored data
- `encrypts-in-transit` - Encrypts transmitted data
- `encrypts-in-use` - Encrypts data during processing (in-memory encryption, secure enclaves, homomorphic encryption) [v1.3]
- `supports-secure-enclave` - Processes data in a hardware-backed secure enclave (e.g., Intel SGX, AWS Nitro Enclaves, AMD SEV) [v1.3]
- `supports-deletion-after-use` - Will delete data after first complete use, satisfying `delete-after-use` covenant [v1.3]

**Collection and Disclosure** [v1.3]:

These capabilities describe what the tool collects, retains, or discloses. They are evaluated against collection and disclosure covenants.

- `collects-data` - Tool ingests and retains data presented to it
- `collects-derived-only` - Tool ingests only derived data (summaries, statistics, embeddings) but not raw input
- `transient-processing-only` - Tool processes data without ingestion or retention
- `discloses-to-government` - Tool may disclose data to government entities
- `appears-in-directory` - Tool publishes references in directory listings or indexes
- `discloses-to-data-subject` - Tool may return data to the data subject (e.g., patient portal)
- `gates-subject-disclosure` - Tool checks `no-disclosure-to-subject` covenant before returning data to subject

**Authorization Verification** [v1.3]:

These capabilities describe the authorization checks a tool can perform. They satisfy authorization-requirement covenants.

- `verifies-subject-authorization` - Tool verifies data-subject authorization before processing (satisfies `subject-authorization-required`)
- `verifies-agreement` - Tool verifies an active agreement (DUA, BAA, MoU) is on file before processing (satisfies `agreement-required`)
- `verifies-agreement-{type}` - Tool verifies a specific agreement type (e.g., `verifies-agreement-baa`)
- `verifies-organizational-policy` - Tool verifies organizational policy authorization (satisfies `organizational-policy-required`)
- `verifies-consent-recency` - Tool verifies authorization currency against a recency window (satisfies `consent-current-required`)
- `verifies-parental-consent` - Tool verifies parental or guardian consent for minor data
- `verifies-professional-determination` - Tool verifies a credentialed professional has authorized the use

**Legal Basis Verification** [v1.4]:
- `verifies-lawful-basis` - Tool verifies a declared lawful basis is active before processing
- `verifies-consent-record` - Tool retrieves and verifies a consent record (satisfies `lawful-basis-consent`)
- `verifies-contract-active` - Tool verifies an active contractual relationship (satisfies `lawful-basis-contract`)
- `verifies-legal-obligation` - Tool verifies a documented legal obligation (satisfies `lawful-basis-legal-obligation`)
- `verifies-public-task-authority` - Tool verifies public-task authority (satisfies `lawful-basis-public-task`)
- `verifies-legitimate-interest-assessment` - Tool verifies a documented LIA (satisfies `lawful-basis-legitimate-interests`)

**AI Processing Capabilities** [v1.4]:

These capabilities describe the AI processing characteristics of a tool. They are evaluated against AI trustworthiness and AI Act covenants.

- `is-ai-system` - Tool incorporates AI processing
- `is-gpai-model` - Tool is a General-Purpose AI model
- `is-high-risk-ai` - Tool is classified as high-risk under EU AI Act
- `validated-and-reliable` - Tool documented as valid and reliable per NIST AI RMF
- `safe-ai` - Tool documented as safe per NIST AI RMF
- `secure-resilient-ai` - Tool documented as secure and resilient per NIST AI RMF
- `accountable-transparent-ai` - Tool supports accountability and transparency per NIST AI RMF
- `explainable-ai` - Tool produces explanations of how outputs are produced
- `interpretable-ai` - Tool produces interpretable outputs
- `privacy-enhanced-ai` - Tool implements privacy-enhancing techniques
- `fair-bias-managed-ai` - Tool has documented bias management
- `provides-human-oversight` - Tool implements human-oversight mechanisms (satisfies `human-oversight-required`)
- `discloses-ai-nature` - Tool discloses to users they are interacting with AI (satisfies `transparency-disclosure-required`)
- `marks-ai-generated-content` - Tool marks AI-generated outputs (satisfies `ai-generated-content-marked`)
- `documents-risk-management-system` - Tool maintains documented risk management system
- `passed-conformity-assessment` - Tool has passed EU AI Act conformity assessment
- `fundamental-rights-impact-assessed` - Tool has documented FRIA
- `produces-confabulations` - Tool may produce hallucinated or confabulated outputs (LLMs)

**Content Provenance and Watermarking** [v1.4]:
- `signs-output-provenance` - Tool signs outputs with provenance metadata (e.g., C2PA)
- `embeds-watermark` - Tool embeds detectable watermarks in outputs
- `produces-synthetic-media` - Tool produces synthetic audio, image, video, or text
- `preserves-attribution` - Tool preserves attribution metadata in derived works (satisfies `attribution-required`)
- `enforces-share-alike` - Tool enforces share-alike licensing in derivatives (satisfies `share-alike-required`)

**Data Subject Rights Support** [v1.4]:
- `supports-right-of-access` - Tool can produce data-subject access reports
- `supports-right-of-erasure` - Tool can perform on-request deletion
- `supports-right-of-portability` - Tool can export data in portable format
- `supports-right-of-rectification` - Tool supports correction requests
- `supports-right-to-object` - Tool supports objection-to-processing requests

**Action Capabilities** (aligned with ODRL action vocabulary) [v1.4]:

These capabilities describe what actions a tool can perform on data. They are evaluated against ODRL-aligned action prohibitions.

- `can-derive` - Can create derivative works
- `can-aggregate` (already defined) - Can aggregate data
- `can-extract` - Can extract portions or excerpts
- `can-index` - Can include in search indexes
- `can-distribute` - Can distribute to third parties
- `can-share` - Can share with other parties
- `can-modify` - Can modify or alter data
- `can-transform` - Can transform format or representation
- `can-translate` - Can translate to other languages
- `can-print` - Can print or render to physical media
- `can-display` - Can display in user interfaces
- `can-execute` - Can execute as code or instructions
- `commercial-use` - Tool is operated for commercial purposes
- `secondary-use` - Tool may use data beyond original purpose
- `tracks-usage` - Tool tracks data subject usage or behavior
- `builds-profiles` - Tool builds behavioral profiles
- `makes-automated-decisions` - Tool makes solely automated decisions

**Cloud and Infrastructure**:
- `cloud-processing` - Processes in cloud environment
- `on-premise-only` - Only processes on-premise
- `multi-tenant` - Operates in multi-tenant environment
- `dedicated-infrastructure` - Uses dedicated infrastructure
- `processes-in-jurisdiction-{code}` - Processes only in specified jurisdiction (e.g., `processes-in-jurisdiction-us`, `processes-in-jurisdiction-eu`) [v1.3]

**Training and Learning**:
- `used-for-model-training` - Data used for model training
- `used-for-analytics` - Data used for analytics
- `no-training-use` - Data not used for training
- `creates-embeddings` - Tool creates and may store vector embeddings of input data [v1.3]
- `indexes-for-rag` - Tool indexes data for retrieval-augmented generation [v1.3]

**Human Interaction**:
- `has-human-in-loop` - Includes human review/approval
- `fully-automated` - No human interaction
- `requires-approval` - Requires human approval

**Access Control**:
- `enforces-rbac` - Enforces role-based access control
- `enforces-mfa` - Enforces multi-factor authentication
- `single-user-access` - Accessed by single user only

**Display and Visibility** (NEW in v1.1):
- `can-display-to-operator` - Can show data in operator interface
- `displays-raw-data` - Shows unredacted raw data values
- `supports-redaction` - Can apply redaction rules to displayed data
- `supports-summarization` - Can generate summaries instead of raw display
- `checks-operator-role` - Verifies operator role before displaying
- `logs-display-events` - Logs all data display events

**Compliance**:
- `hipaa-compliant` - HIPAA compliant infrastructure
- `gdpr-compliant` - GDPR compliant infrastructure
- `pci-dss-compliant` - PCI-DSS compliant infrastructure
- `soc2-compliant` - SOC2 certified
- `fedramp-authorized` - FedRAMP authorized
- `42-cfr-part-2-compliant` - Compliant with 42 CFR Part 2 substance use treatment confidentiality [v1.3]
- `gina-compliant` - Compliant with Genetic Information Nondiscrimination Act [v1.3]
- `eu-ai-act-compliant` - Documented EU AI Act compliance [v1.4]
- `iso-iec-42001-certified` - ISO/IEC 42001 AI management system certified [v1.4]
- `iso-iec-27001-certified` - ISO/IEC 27001 information security certified [v1.4]
- `iso-iec-27701-certified` - ISO/IEC 27701 privacy information certified [v1.4]
- `nist-ai-rmf-aligned` - Documented alignment with NIST AI RMF [v1.4]
- `nist-csf-aligned` - Documented alignment with NIST CSF [v1.4]
- `nist-800-53-controls-implemented` - NIST SP 800-53 controls implemented [v1.4]
- `c2pa-compliant` - Coalition for Content Provenance and Authenticity compliant [v1.4]

### 8.5 Vocabulary Extension

Organizations MAY extend CDL vocabulary with domain-specific terms. LLMs will interpret new terms through semantic understanding:

**Example Custom Covenants**:
```json
{
  "x-cdl-covenants": [
    "acme-corp-data-policy-v2",
    "research-ethics-approved",
    "customer-consent-obtained",
    "quality-assurance-verified"
  ]
}
```

**Example Custom Capabilities**:
```json
{
  "x-cdl-capabilities": [
    "integrates-with-salesforce",
    "supports-blockchain-audit",
    "quantum-safe-encryption",
    "zero-knowledge-proof-capable"
  ]
}
```

**Best Practices for Extension**:
1. Use clear, descriptive hyphenated names
2. Document custom vocabulary in API documentation
3. Provide examples of LLM interpretation
4. Consider contributing widely-applicable terms back to CDL standard

---

## 9. Signature and Trust

### 9.1 Purpose

Cryptographic signatures prove that CDL declarations are authentic and have not been tampered with. This establishes trust in governance metadata traveling with data.

### 9.2 Signature Format

CDL signatures extend PSP signature specifications (RFC-PSP-CORE):

```json
{
  "x-cdl-classes": "phi confidential",
  "x-cdl-covenants": "hipaa no-persist no-training healthcare-staff-only",
  "x-cdl-signature": {
    "value": "ed25519:base64-encoded-signature",
    "algorithm": "ed25519",
    "timestamp": "2025-11-12T10:00:00Z",
    "expires": "2026-11-12T10:00:00Z",
    "signer": "compliance-officer@healthcare.example.com",
    "signer_role": "HIPAA Compliance Officer",
    "validation_endpoint": "https://healthcare.example.com/cdl/validate"
  }
}
```

### 9.3 Signature Scope

Signatures cover:
1. All `x-cdl-classes` declarations
2. All `x-cdl-covenants` declarations
3. All `x-cdl-capabilities` declarations
4. The JSON Schema structure itself (when signing schema-bound declarations)

### 9.4 Validation Process

```
1. Extract x-cdl-signature from declaration
2. Reconstruct canonical representation of signed content:
   - Normalize to lowercase
   - Sort declarations alphabetically
   - Remove whitespace variations
3. Retrieve public key for signer (via validation_endpoint or key registry)
4. Verify signature using public key and algorithm
5. Check timestamp and expiration
6. Verify signer role has authority for this declaration type
7. Cache validation result (with TTL based on expires field)
```

### 9.5 Trust Models

**Self-Signed** (lowest trust):
- No external validation
- Signature proves integrity only, not authority
- Appropriate for internal organizational use

**Organizational Validation** (medium trust):
- Validation endpoint within organization
- Signer verified against internal directory
- Appropriate for enterprise deployments

**Third-Party Attestation** (highest trust):
- External compliance authority validates
- Realflow.ai governance platform attestation
- Industry consortium validation
- Appropriate for cross-organizational data sharing

### 9.6 Signature Requirements

**Declarations SHOULD be signed when**:
- Data crosses organizational boundaries
- Compliance frameworks require attestation (HIPAA, PCI-DSS)
- Data is highly sensitive (PHI, PCI, secrets)
- Legal or regulatory audit trail required

**Declarations MAY be unsigned when**:
- Internal organizational use only
- Infrastructure authentication sufficient (mTLS, API keys)
- Low sensitivity data (internal, public)

---

## 10. Implementation Requirements

### 10.1 Minimum Implementation

Conforming implementations MUST:

1. **Parse both formats**: Accept string and array formats for all declaration types
2. **Support inheritance**: Implement hierarchical inheritance for covenants and classes
3. **Support negation**: Handle `!` prefix for covenant removal
4. **Normalize case**: Treat declarations as case-insensitive
5. **Handle duplicates**: Ignore duplicate declarations
6. **Support all three types**: Handle classes, covenants, and capabilities

### 10.2 Recommended Implementation

Implementations SHOULD:

1. **Support multiple discovery patterns**: Implement all capability discovery patterns (Section 5)
2. **Validate signatures**: Verify cryptographic signatures when present
3. **Cache validations**: Cache validation results with appropriate TTL
4. **Log governance decisions**: Create audit trail of covenant enforcement
5. **Provide clear errors**: Explain covenant violations to users and LLMs
6. **Support vocabulary extension**: Allow custom covenant/capability terms

### 10.3 LLM Integration

LLM systems using CDL SHOULD:

1. **Check covenants before tool routing**: Verify covenant-capability compatibility
2. **Explain violations**: Provide clear reasoning when refusing requests
3. **Suggest alternatives**: Offer compliant alternatives when available
4. **Maintain audit trail**: Log all covenant-related decisions
5. **Preserve governance in context**: Keep covenant context across multi-turn conversations
6. **Handle human-in-loop**: Escalate covenant violations to humans when appropriate

### 10.4 Tool/Agent Implementation

Tools and agents declaring capabilities SHOULD:

1. **Be honest**: Declare all actual capabilities, including transitive ones
2. **Be complete**: Include all side effects (logging, persistence, transmission)
3. **Be specific**: Use precise capability terms
4. **Update declarations**: Keep capability declarations current with code changes
5. **Document extensions**: Clearly document any custom capability terms

---

## 11. RBAC Vocabulary

### 11.1 Purpose

CDL governance often requires expressing **who** can access data, not just **what** the data is. This section extends CDL vocabulary to include role-based access control declarations.

### 12.2 Identity-Based Covenants

Identity covenants express requirements about the authenticated identity accessing data:

**Role Requirements**:
```json
{
  "x-cdl-covenants": "physician-only attending-only nurse-access-allowed"
}
```

**Clearance Levels**:
```json
{
  "x-cdl-covenants": "confidential-clearance secret-clearance public-access"
}
```

**Department Restrictions**:
```json
{
  "x-cdl-covenants": "cardiology-only billing-dept-access hr-access-required"
}
```

**Authentication Strength**:
```json
{
  "x-cdl-covenants": "mfa-required strong-auth-required verified-identity-required"
}
```

### 12.3 Identity-Based Capabilities

Tools and agents can declare their identity enforcement capabilities:

**RBAC Enforcement**:
```json
{
  "x-cdl-capabilities": "enforces-rbac validates-identity filters-by-role"
}
```

**Authentication Support**:
```json
{
  "x-cdl-capabilities": "supports-sso supports-mfa can-verify-identity"
}
```

**Claim Validation**:
```json
{
  "x-cdl-capabilities": "validates-roles validates-clearance validates-department"
}
```

### 12.4 Covenant-Capability Matching

LLMs match identity covenants against tool capabilities semantically:

**Match Examples**:
- `physician-only` ← requires → `enforces-rbac validates-roles`
- `mfa-required` ← requires → `supports-mfa can-verify-identity`
- `confidential-clearance` ← requires → `validates-clearance filters-by-role`

**Conflict Examples**:
- `physician-only` conflicts with tool lacking `enforces-rbac`
- `mfa-required` conflicts with tool lacking `supports-mfa`

### 12.5 Hierarchical Role Declarations

Roles can be specified at different schema levels:

```json
{
  "type": "object",
  "x-cdl-classes": "phi confidential",
  "x-cdl-covenants": "hipaa healthcare-staff-only verified-identity-required",
  "properties": {
    "patientName": {
      "type": "string",
      "x-cdl-covenants": "physician-access nurse-access"
    },
    "diagnosis": {
      "type": "string",
      "x-cdl-covenants": "physician-only"
    },
    "billing": {
      "type": "object",
      "x-cdl-covenants": "billing-dept-only financial-clearance"
    }
  }
}
```

### 12.6 Anonymous vs Authenticated

Data can specify whether anonymous access is allowed:

```json
{
  "x-cdl-covenants": "authenticated-only verified-identity-required"
}
```

Or explicitly allow anonymous access:

```json
{
  "x-cdl-covenants": "!authenticated-only public-access anonymous-allowed"
}
```

### 12.7 PSP Identity Context

Identity information flows into LLM context through PSP-signed prompts (see RFC-PSP-CORE). The identity context provides the verified claims that LLMs use to enforce identity-based covenants.

**PSP Identity Section Format**:
```json
{
  "psig": "1",
  "alg": "ed25519",
  "sig": "a1b2c3d4...",
  "kid": "signer-key-123",
  "iat": "2025-11-13T10:00:00Z",
  "exp": "2025-11-13T11:00:00Z",
  "content": {
    "identity": {
      "sub": "user123",
      "email": "dr.smith@hospital.com",
      "roles": ["PHYSICIAN", "ATTENDING"],
      "permissions": [
        "read:patient_records",
        "write:prescriptions",
        "approve:treatment_plans"
      ],
      "department": "CARDIOLOGY",
      "clearance": "CONFIDENTIAL",
      "authenticated_at": "2025-11-13T09:55:00Z",
      "auth_method": "MFA"
    }
  },
  "signer": "identity-service@hospital.com"
}
```

**Roles vs Permissions:**
- **Roles** are organizational positions (e.g., "PHYSICIAN", "MANAGER", "BILLING_STAFF")
- **Permissions** are specific grants (e.g., "read:patient_records", "write:prescriptions", "approve:expenses")

Organizations MAY use roles-only, permissions-only, or both. Permissions provide fine-grained control when roles are too coarse.

**How LLMs Use Identity Context**:

1. **Verify PSP Signature** - Ensure identity claims are authentic
2. **Extract Identity Claims** - Parse roles, clearances, departments from signed context
3. **Match Against Covenants** - Compare identity claims to covenant requirements
4. **Enforce Access Control** - Allow/deny based on covenant-identity match

**Example Matching**:
```
Data Covenant: "physician-only cardiology-dept-only mfa-required"

Identity Context (from PSP):
- roles: ["PHYSICIAN", "ATTENDING"]
- permissions: ["read:patient_records", "write:prescriptions"]
- department: "CARDIOLOGY"
- auth_method: "MFA"

LLM Reasoning:
✓ physician-only satisfied by roles containing "PHYSICIAN"
✓ cardiology-dept-only satisfied by department = "CARDIOLOGY"
✓ mfa-required satisfied by auth_method = "MFA"
→ ALLOW access

Alternative with permission-based matching:
Data Covenant: "requires:read:patient_records"
- permissions: ["read:patient_records"]
→ ALLOW access
```

**Identity Without PSP Signature**:

Unsigned identity claims SHOULD be treated as untrusted:
```json
{
  "identity": {
    "roles": ["PHYSICIAN"]
  }
  // No PSP signature - cannot be trusted
}
```

LLMs SHOULD reject identity-based covenant enforcement without verified PSP signature:
```
Data covenant: "physician-only"
Identity: Present but unsigned

LLM Response: "I cannot verify your identity. Access to this data 
requires cryptographically verified credentials. Please authenticate 
through a trusted identity provider."
```

**Multiple Identity Contexts**:

In multi-party scenarios, PSP can include multiple identities:
```json
{
  "psig": "1",
  "content": {
    "user_identity": {
      "sub": "patient123",
      "roles": ["PATIENT"],
      "member_id": "M123456789"
    },
    "agent_identity": {
      "sub": "agent456",
      "roles": ["CUSTOMER_SERVICE", "BENEFITS_SPECIALIST"],
      "department": "MEMBER_SERVICES"
    }
  }
}
```

LLMs apply different covenants to different identities based on context.

### 12.8 Standard RBAC Vocabulary

**Role-Based Covenants**:
- `physician-only`, `nurse-only`, `medical-staff-only`
- `admin-only`, `manager-approval-required`
- `billing-dept-only`, `hr-dept-only`, `finance-only`
- `member-access-only`, `customer-access-only`

**Permission-Based Covenants**:
- `requires:read:patient_records`, `requires:write:prescriptions`
- `requires:approve:expenses`, `requires:delete:records`
- `requires:export:data`, `requires:manage:users`

**Clearance-Based Covenants**:
- `public-access`, `internal-only`, `confidential-clearance`, `secret-clearance`
- `executive-level`, `board-level`

**Authentication Covenants**:
- `authenticated-only`, `verified-identity-required`
- `mfa-required`, `strong-auth-required`
- `sso-required`, `corporate-credentials-required`

**RBAC Capabilities**:
- `enforces-rbac`, `validates-identity`, `filters-by-role`, `filters-by-permission`
- `supports-sso`, `supports-mfa`, `can-verify-identity`
- `validates-roles`, `validates-permissions`, `validates-clearance`, `validates-department`

**Permission Naming Convention**:

Permission-based covenants use the format `requires:<action>:<resource>`:
- Actions: `read`, `write`, `delete`, `approve`, `export`, `manage`, `execute`
- Resources: Organization-specific (e.g., `patient_records`, `expenses`, `reports`)

Example: `requires:approve:treatment_plans` means data requires permission "approve:treatment_plans"

### 12.9 LLM Reasoning Pattern

When LLMs encounter identity covenants:

1. **Detect identity requirement**: Recognize covenant requires authenticated identity
2. **Check current identity**: Determine if identity context exists
3. **Validate capabilities**: Ensure tool can enforce identity requirements
4. **Match covenant to identity**: Verify identity satisfies covenant
5. **Proceed or block**: Allow or deny based on identity match

**Example**:
```
Data covenant: "physician-only mfa-required"
Tool capabilities: "enforces-rbac supports-mfa validates-roles"
Current identity: { "role": "physician", "mfa": true }

LLM reasoning:
✓ Tool supports RBAC enforcement
✓ Tool validates roles
✓ Tool supports MFA
✓ Identity has physician role
✓ Identity authenticated with MFA
→ ALLOW access
```

### 12.10 Integration with Other Covenants

Identity covenants combine with other CDL covenants:

```json
{
  "x-cdl-classes": "phi pii",
  "x-cdl-covenants": [
    "hipaa",
    "no-training",
    "audit-required",
    "physician-only",
    "mfa-required",
    "verified-identity-required"
  ]
}
```

All covenants must be satisfied for data access.

---

## 12. Relationship to Existing Standards

### 12.1 Purpose of This Section

CDL was developed to address governance requirements specific to AI tool-calling systems and LLM-mediated workflows. Several of the conceptual primitives CDL relies on — confidentiality classifications, prohibited actions, mandated obligations, and capability declarations — have been the subject of prior standardization in adjacent domains, notably healthcare interoperability, digital rights expression, access control, and privacy regulation.

This section identifies the relevant prior standards, describes how CDL relates to each, and articulates the specific contributions CDL makes that those prior standards do not cover. The purpose is to enable interoperability between CDL-aware systems and existing governance infrastructure, and to allow implementers to reuse mature vocabulary where appropriate rather than reinventing it.

CDL does not replace any of the standards described in this section. Where applicable, CDL implementations SHOULD treat declarations from these standards as authoritative for the domains those standards govern.

### 12.2 HL7 Healthcare Privacy and Security Classification System

The HL7 Healthcare Privacy and Security Classification System (HCS), Release 1, defines a normative conceptual model for security labels in healthcare information exchange. HCS is the foundation for security labeling in HL7 V2 (Version 2.x messaging), HL7 CDA (Clinical Document Architecture), and HL7 FHIR (Fast Healthcare Interoperability Resources).

HCS defines five categories of security label fields:

1. **Confidentiality** — A total-order hierarchy of protection levels (Unrestricted, Low, Moderate, Normal, Restricted, Very Restricted), with a mandatory cardinality of exactly one Confidentiality value per security label.
2. **Sensitivity** — Non-hierarchical tags identifying the policy basis for restricted access (e.g., behavioral health, substance use, HIV, genetic, employment).
3. **Compartment** — Tags segmenting access to defined communities or projects.
4. **Integrity** — Tags conveying assertions about data quality, source, and reliability.
5. **Handling Caveat** — Obligation and Refrain policy tags constraining downstream use.

The HCS Handling Caveat category is implemented through two value sets in the HL7 V3 ActCode code system:

- **RefrainPolicy** — Conveys prohibited actions which an information custodian, receiver, or user is not permitted to perform unless otherwise authorized. Examples include `NORDSCLCD` (no redisclosure without consent directive), `NOPERSISTP` (no persist), `NOAUTH` (no unauthorized disclosure), `NOMOU` (no use without memorandum of understanding), `NOORGPOL` (no use without organizational policy authorization), `NOPAT` (information may not be disclosed to the patient), and `NOCOLLECT` (no collection).
- **ObligationPolicy** — Conveys mandated workflow actions a custodian, receiver, or user must perform. Examples include `ENCRYPT` (encrypt), `MASK` (mask), `ANONY` (anonymize), `DEID` (de-identify), `AUDIT` (audit), `AUDTR` (maintain audit trail), `DELAU` (delete after use), and `PROCESSINLINELABEL` (resource contains inline labels requiring per-element processing). The HL7 ObligationPolicy specification explicitly cites OASIS XACML as its conceptual basis: "Per OASIS XACML, an obligation is an operation specified in a policy that is performed in conjunction with the enforcement of an access control decision."

HCS labels in FHIR are attached to resource **instances** via the `meta.security` element, or to specific elements within a resource via the DS4P (Data Segmentation for Privacy) Implementation Guide's `extension-inline-sec-label` extension.

**Relationship to CDL**: CDL's `x-cdl-classes` vocabulary for sensitivity classification (`phi`, `pii`, `confidential`, `restricted`, `psychiatric-information`, `hiv-information`, `genetic-information`, etc.) corresponds directly to HCS Confidentiality codes and InformationSensitivityPolicy categories. CDL's `x-cdl-covenants` vocabulary for prohibitions and obligations (`no-persist`, `no-disclosure-to-subject`, `subject-authorization-required`, `agreement-required`, `de-identification-required`, `delete-after-use`, etc.) corresponds directly to HCS RefrainPolicy and ObligationPolicy codes.

As of CDL v1.3, every primary HL7 RefrainPolicy code, ObligationPolicy code, Confidentiality code, and primary InformationSensitivityPolicy code has a direct CDL equivalent. Appendix C provides the complete bidirectional mapping. CDL implementations MAY use either CDL native vocabulary or HL7 codes referenced via canonical URIs; both forms are normative and interchangeable. Mixed usage is permitted within a single declaration array.

CDL implementations operating in healthcare contexts SHOULD support a binding mode that accepts HL7 codes directly (e.g., `hl7:NORDSCLCD` or the full URI `http://terminology.hl7.org/CodeSystem/v3-ActCode#NORDSCLCD`) and treats them as semantically equivalent to the corresponding CDL native term during conflict and satisfaction evaluation.

CDL differs from HCS in three architectural respects:

1. **Schema-level rather than instance-level attachment.** HCS labels travel on individual FHIR resource instances. CDL declarations attach to JSON Schema definitions, with all instances of a given schema inheriting its declarations. This eliminates the per-instance labeling step that HCS requires and avoids the privacy concern HCS itself notes — that the presence of a `MASK` or `NORDSCLCD` label on a specific field can leak information about what the field contains. CDL's schema-level declaration places governance on the type definition, where it does not vary instance-to-instance.

2. **Tool/agent capability declarations.** HCS has no concept corresponding to CDL's `x-cdl-capabilities`. HCS labels describe data; they do not describe what consumers may do or how consumers self-describe their abilities. In an HCS deployment, capability matching is performed by a separate XACML Policy Decision Point against externally maintained policy. CDL elevates capability declarations to a first-class, orthogonal vocabulary attached to MCP tools, agents, and services, enabling matching to be performed on declarations that travel with both the data and the tools.

3. **LLM-native semantic enforcement as one of several supported topologies.** HCS assumes a deterministic external PDP (typically XACML-based). CDL supports the same deterministic enforcement model (Section 7.6, Topologies B and C) and additionally supports semantic enforcement by the inference engine (Topology A) for environments without a proxied infrastructure layer. The LLM enforcement mode is not a replacement for deterministic PDPs in regulated contexts; it is a graceful-degradation mode for unproxied scenarios.

CDL extends beyond HCS in several areas where HCS has no equivalent: AI training and learning covenants (`no-training`, `no-fine-tuning`, `no-embedding-storage`, `no-rag-indexing`); operator-visibility covenants enabling LLM-as-trusted-intermediary patterns (`no-display-to-operator`, `summary-only-display`, `role-restricted-display`); and the entire `x-cdl-capabilities` vocabulary for tool self-description. These extensions reflect AI-tool-calling requirements that did not exist when HCS was developed.

### 12.3 W3C Open Digital Rights Language (ODRL)

The W3C Open Digital Rights Language (ODRL) is a policy expression language standardized in two W3C Recommendations published in February 2018: ODRL Information Model 2.2 and ODRL Vocabulary and Expression 2.2. ODRL provides a tri-fold information model of **Permissions**, **Prohibitions**, and **Duties (Obligations)** over assets, with associated Constraints. The ODRL Common Vocabulary defines approximately 50 action verbs (`play`, `display`, `print`, `copy`, `aggregate`, `archive`, `derive`, `extract`, `index`, `modify`, `transform`, `translate`, `share`, `sell`, `lend`, `lease`, `commercialize`, `secondaryUse`, `shareAlike`, `attribute`, `watermark`, `acceptTracking`, and others).

ODRL was originally developed for digital rights management in publishing and media distribution. The W3C ODRL Community Group continues to develop the specification, with ODRL 3.0 work focused on adding enforcement mechanisms to what is currently an expression-only standard.

**Relationship to CDL**: CDL's three declaration types map conceptually to ODRL's tri-fold model. CDL `x-cdl-classes` provides asset typing similar to ODRL's asset references. CDL `x-cdl-covenants` covers both prohibitions and obligations in a unified vocabulary (using the `!` negation prefix to distinguish removal from assertion). CDL `x-cdl-capabilities` provides a tool-side declaration vocabulary that ODRL itself does not include.

As of CDL v1.4, CDL provides direct equivalents for the primary ODRL action prohibitions (`no-derive`, `no-aggregate`, `no-extract`, `no-index`, `no-distribute`, `no-share`, `no-modify`, `no-transform`, `no-translate`, `no-print`, `no-display`, `no-execute`, `no-commercial-use`, `no-secondary-use`, `no-resale`, `no-sublicense`) and for the primary ODRL/Creative Commons license requirements (`attribution-required`, `share-alike-required`, `notify-on-use`, `inform-of-recipients`, `obtain-consent-each-use`, `pay-required`).

CDL implementations MAY translate CDL declarations into ODRL policies for interoperability with ODRL-aware systems. Conversely, ODRL action vocabulary may be used directly in CDL declarations via the `odrl:` prefix (e.g., `odrl:aggregate` is equivalent to `no-aggregate` when used in a prohibition context).

CDL differs from ODRL in scope and binding:

1. **JSON Schema binding rather than RDF/OWL binding.** ODRL is serialized in JSON-LD or RDF Turtle and grounded in OWL ontologies. CDL is serialized as JSON Schema extensions (`x-cdl-*` properties), making it directly usable by JSON Schema validators and code generators without requiring an RDF stack.

2. **AI tool-calling focus.** ODRL was designed for asset usage (play a song, view a document, redistribute a file). CDL is designed for AI tool dispatch decisions (may this tool process this data, may this data be sent to this model). The two are complementary; CDL's vocabulary includes the ODRL action prohibitions plus AI-specific covenants (training, profiling, automated decision-making, AI trustworthiness) that ODRL does not address.

### 12.4 OASIS XACML

The OASIS eXtensible Access Control Markup Language (XACML) is a standard for attribute-based access control. XACML defines a policy decision point (PDP) architecture in which policies, expressed as rules over subject/resource/action/environment attributes, produce permit/deny/indeterminate decisions plus optional Obligations and Advice.

XACML is the conceptual ancestor of HL7 ObligationPolicy (HL7 documentation explicitly cites this lineage) and is widely deployed in enterprise access control infrastructure.

**Relationship to CDL**: CDL is not an access control language; it is a governance declaration language. CDL declarations describe what data IS, what MUST or MUST NOT be done with it, and what tools CAN do. CDL does not specify subject/resource/action/environment evaluation rules. In Topology B and C deployments (Section 7.6), the CDL-aware chat host or MCP proxy functions analogously to a XACML PDP, but the policy expression is CDL declarations rather than XACML rules.

CDL implementations MAY translate CDL declarations into XACML policies for evaluation by an existing XACML PDP. This is a recommended integration pattern for organizations with established XACML infrastructure.

### 12.5 W3C Data Privacy Vocabulary (DPV)

The W3C Data Privacy Vocabulary (DPV), maintained by the W3C Data Privacy Vocabularies and Controls Community Group, provides taxonomies for personal data categories, processing operations, purposes, legal bases, technical and organisational measures (TOMs), and rights, primarily derived from the EU GDPR. DPV is referenced by ISO/IEC TS 27560:2023 for machine-readable consent records.

DPV integrates with ODRL via a published mapping file (`dpv-odrl.ttl`), enabling DPV concepts to be used as ODRL constraint operands.

**Relationship to CDL**: As of CDL v1.4, CDL provides direct equivalents for the primary DPV concepts:

- **Legal bases** (DPV LegalBasis taxonomy, GDPR Article 6): CDL `lawful-basis-consent`, `lawful-basis-contract`, `lawful-basis-legal-obligation`, `lawful-basis-vital-interests`, `lawful-basis-public-task`, `lawful-basis-legitimate-interests`, plus GDPR Article 9 special-category bases (`lawful-basis-explicit-consent`, `lawful-basis-substantial-public-interest`).
- **Purposes** (DPV Purpose taxonomy): CDL `purpose-service-provision`, `purpose-personalization`, `purpose-marketing`, `purpose-research`, `purpose-fraud-prevention`, `purpose-security`, `purpose-compliance`, etc.
- **Data subject rights** (DPV Rights taxonomy, GDPR Chapter III): CDL `right-of-access`, `right-of-rectification`, `right-of-erasure`, `right-of-portability`, `right-of-restriction`, `right-to-object`, `right-not-to-be-subject-to-automated-decisions`, `right-to-explanation`.
- **Technical and organisational measures** (DPV TOM taxonomy): CDL covers via existing covenants for encryption, audit, retention, access control, plus v1.3 additions for de-identification and authorization verification.
- **Personal data categories**: CDL has `pii`, `gdpr-subject`, `coppa-subject` plus the v1.3 clinical sensitivity categories. For deeper personal-data-category granularity, CDL implementations MAY use DPV concepts directly via the `dpv:` prefix.

CDL implementations operating under GDPR or similar regulatory frameworks SHOULD treat DPV as authoritative for personal data categorization at the leaf level and MAY use DPV concept URIs directly in CDL declarations.

### 12.6 NIST Role-Based Access Control

NIST RBAC (NIST Special Publication 800-162 and related documents) provides the conceptual foundation for role-based access control widely deployed in enterprise systems. CDL's RBAC vocabulary (Section 11) draws on NIST RBAC concepts.

**Relationship to CDL**: CDL's `role-based-access` covenant and `enforces-rbac` capability are direct references to RBAC enforcement. CDL does not redefine RBAC; it provides vocabulary to declare RBAC requirements on data and to declare RBAC capabilities on tools. Underlying role definitions, role hierarchies, and permission assignments remain the responsibility of the deploying organization's identity infrastructure.

### 12.7 EU Artificial Intelligence Act

The EU AI Act (Regulation (EU) 2024/1689) is the first comprehensive legal framework for AI, published in the EU Official Journal on July 12, 2024 and progressively applicable through 2027. The Act establishes a risk-based regulatory framework with four tiers (unacceptable, high, limited, minimal risk) plus distinct obligations for General-Purpose AI (GPAI) models. The Act imposes obligations including risk management systems, technical documentation, human oversight, transparency, and conformity assessment for high-risk systems.

**Relationship to CDL**: CDL v1.4 provides direct support for EU AI Act compliance:

- **Risk classifications** (Article 5, 6, 7, Annex III): CDL classifications `ai-unacceptable-risk`, `ai-high-risk`, `ai-limited-risk`, `ai-minimal-risk`, `ai-gpai-model`, `ai-gpai-systemic-risk`.
- **High-risk system obligations** (Articles 9–15, 27): CDL covenants `risk-management-system-required`, `human-oversight-required`, `conformity-assessment-required`, `fundamental-rights-impact-assessed`, `transparency-disclosure-required`.
- **GPAI obligations** (Articles 53–55): CDL covenants `ai-generated-content-marked`, `transparency-disclosure-required`.
- **Tool-side compliance declarations**: CDL capabilities `is-ai-system`, `is-gpai-model`, `is-high-risk-ai`, `passed-conformity-assessment`, `provides-human-oversight`, `discloses-ai-nature`, `marks-ai-generated-content`, `documents-risk-management-system`, `eu-ai-act-compliant`.

CDL implementations operating in scope of the EU AI Act SHOULD attach the appropriate risk classification to data flowing through AI systems and SHOULD declare the corresponding obligations as covenants. AI tools operated within EU-relevant deployments SHOULD declare their conformity capabilities so that the Topology B/C policy decision points can verify compliance before tool dispatch.

### 12.8 NIST AI Risk Management Framework

The NIST AI Risk Management Framework (AI RMF 1.0, NIST AI 100-1, January 2023) and its companion Generative AI Profile (NIST AI 600-1, July 2024) provide voluntary guidance for managing AI risks. The framework defines seven characteristics of trustworthy AI: valid and reliable, safe, secure and resilient, accountable and transparent, explainable and interpretable, privacy-enhanced, and fair with harmful bias managed. It organizes risk management into four functions: GOVERN, MAP, MEASURE, and MANAGE.

**Relationship to CDL**: CDL v1.4 provides direct vocabulary for the seven NIST AI RMF trustworthiness characteristics as both data covenants (declaring the requirement) and tool capabilities (declaring satisfaction):

| NIST Characteristic | CDL Covenant | CDL Capability |
|---|---|---|
| Valid and Reliable | `valid-and-reliable-required` | `validated-and-reliable` |
| Safe | `safe-ai-required` | `safe-ai` |
| Secure and Resilient | `secure-resilient-ai-required` | `secure-resilient-ai` |
| Accountable and Transparent | `accountable-transparent-ai-required` | `accountable-transparent-ai` |
| Explainable and Interpretable | `explainable-ai-required`, `interpretable-ai-required` | `explainable-ai`, `interpretable-ai` |
| Privacy Enhanced | `privacy-enhanced-ai-required` | `privacy-enhanced-ai` |
| Fair with Harmful Bias Managed | `fair-bias-managed-required` | `fair-bias-managed-ai` |

CDL implementations using NIST AI RMF as a reference framework SHOULD declare the relevant trustworthiness covenants on data subject to AI processing, and AI tools SHOULD declare the corresponding capabilities. The `nist-ai-rmf` covenant provides framework-level declaration; `nist-ai-rmf-aligned` provides framework-level capability attestation.

### 12.9 ISO/IEC 42001 and Related ISO Standards

ISO/IEC 42001:2023 is the first international management system standard specifically for artificial intelligence. ISO/IEC 27001:2022 (information security management) and ISO/IEC 27701:2019 (privacy information management) are related standards widely adopted for organizational compliance certification.

**Relationship to CDL**: CDL v1.4 provides framework-level covenants (`iso-iec-42001`, `iso-iec-27001`, `iso-iec-27701`) and the corresponding capabilities (`iso-iec-42001-certified`, `iso-iec-27001-certified`, `iso-iec-27701-certified`). Specific control requirements within these standards are addressed by the existing CDL vocabulary for encryption, audit, access control, and authorization verification.

### 12.10 Creative Commons and Content Licensing

Creative Commons license terms (BY, SA, NC, ND) and similar content licensing vocabularies (the IPTC RightsML profile of ODRL, the W3C ODRL Profile of Creative Commons) define attribution, share-alike, non-commercial, and no-derivatives requirements widely used for digital content.

**Relationship to CDL**: CDL v1.4 provides direct equivalents:

| Creative Commons Term | CDL Covenant |
|---|---|
| BY (Attribution) | `attribution-required` |
| SA (ShareAlike) | `share-alike-required` |
| NC (NonCommercial) | `no-commercial-use` |
| ND (NoDerivatives) | `no-derive`, `no-modify` |

This enables CDL declarations to express CC-style content licensing alongside data governance covenants in a single declaration array.

### 12.11 C2PA Content Provenance

The Coalition for Content Provenance and Authenticity (C2PA) defines a technical specification for content provenance metadata. C2PA is widely adopted for AI-generated content marking and authenticity verification.

**Relationship to CDL**: CDL v1.4 provides classifications for synthetic content (`ai-generated`, `ai-assisted`, `synthetic-media`, `deepfake`) and capabilities for content provenance (`signs-output-provenance`, `embeds-watermark`, `produces-synthetic-media`) plus framework-level capability `c2pa-compliant`. These align with C2PA's authenticity and provenance model.

### 12.12 Industry Conventions for AI Training

The "Do Not Train" designation has emerged as an industry convention for content owners to signal exclusion from generative AI training datasets. The Spawning DNT registry, honored by Stability AI and HuggingFace as of early 2025, represents one such convention. State-level legislation in 2025 began addressing similar concepts.

These conventions are not yet formalized standards. CDL's `no-training`, `no-fine-tuning`, `no-learning`, `no-embedding-storage`, and `no-rag-indexing` covenants align with the intent of these industry conventions. CDL implementations SHOULD honor declarations from established DNT registries when processing data subject to such declarations, in addition to respecting `x-cdl-covenants` declarations.

### 12.13 Summary

| Standard | Domain | CDL Coverage in v1.4 |
|---|---|---|
| HL7 HCS / RefrainPolicy / ObligationPolicy / Confidentiality / InformationSensitivityPolicy | Healthcare data labeling | Complete bidirectional mapping (Appendix C); native CDL vocabulary or HL7 binding mode |
| W3C ODRL | Digital rights expression | ODRL action vocabulary covered as native CDL prohibitions and capabilities; CDL adds AI-specific concepts ODRL lacks |
| OASIS XACML | Attribute-based access control | Architectural alignment in Topology B/C; CDL declarations may be translated to XACML policies |
| W3C DPV | Personal data privacy | Legal bases, purposes, data subject rights, TOMs all covered natively; DPV personal-data-category leaf concepts may be used via `dpv:` prefix |
| NIST RBAC | Role-based access control | CDL provides declaration vocabulary; underlying RBAC infrastructure unchanged |
| EU AI Act | AI regulation | Risk classifications, high-risk obligations, GPAI obligations, FRIA, conformity assessment all natively supported |
| NIST AI RMF | AI risk management | All seven trustworthiness characteristics covered as covenants and capabilities |
| ISO/IEC 42001 | AI management system | Framework-level covenant and certification capability |
| ISO/IEC 27001/27701 | Information security and privacy management | Framework-level covenants and certification capabilities |
| Creative Commons | Content licensing | BY/SA/NC/ND all covered |
| C2PA | Content provenance | Synthetic content classifications and provenance capabilities |
| DNT registries | AI training opt-out | Aligned intent; CDL implementations should honor both |

CDL's specific contributions, distinct from any of the above, are:

1. JSON Schema binding with `x-cdl-*` extensions, hierarchical inheritance, and `!` negation
2. The orthogonal capability declaration vocabulary (`x-cdl-capabilities`) for MCP tools and agents
3. The two-tier enforcement model supporting both deterministic PDP-style enforcement at AI infrastructure chokepoints (Topologies B and C) and graceful semantic-only enforcement in unproxied environments (Topology A)
4. Operator-visibility covenants enabling LLM-as-trusted-intermediary patterns where processing authority and viewing authority diverge
5. Cryptographic binding via PSP signatures (RFC-PSP-CORE) for tamper-evident covenant transport
6. Unified vocabulary across healthcare (HL7), privacy (DPV), digital rights (ODRL), AI risk (NIST AI RMF, EU AI Act), and content provenance (C2PA), enabling a single declaration array to express requirements drawn from multiple regulatory and technical frameworks

---

## 13. Security Considerations

### 13.1 Signature Verification

- Implementations MUST verify signatures before trusting governance declarations
- Expired signatures MUST be rejected
- Signature algorithms MUST be cryptographically secure (Ed25519, RSA-PSS, ECDSA)
- Validation endpoints MUST use HTTPS

### 13.2 Capability Honesty

- Tools MUST NOT lie about capabilities to bypass covenant enforcement
- Implementations SHOULD audit tool behavior against declared capabilities
- Transitive capability rules MUST be enforced (Section 5.8)

### 13.3 Covenant Tampering

- Unsigned covenants can be removed by intermediaries
- Sensitive data SHOULD use signed covenants
- LLMs SHOULD warn users when using unsigned covenants for sensitive data

### 13.4 LLM Jailbreaking

- CDL relies on LLM instruction-following for enforcement in Topology A (unproxied) deployments
- Adversarial prompts may attempt to bypass covenant checks at the model layer
- For sensitive data, deploy in Topology B or C (Section 7.6) for deterministic enforcement
- High-sensitivity scenarios SHOULD use defense-in-depth across all available enforcement layers

### 13.5 Privacy Considerations

- Covenant declarations may reveal sensitive information about data
- `x-cdl-classes` like `phi` or `financial` indicate data content
- Consider encrypting governance metadata for highly sensitive scenarios
- Validation endpoints reveal organizational structure (signer roles, departments)

### 13.6 Compliance Attestation

- Capability declarations are assertions, not guarantees
- Third-party audits SHOULD verify capability claims
- Compliance certifications (SOC2, HIPAA) provide stronger assurance
- Organizations SHOULD periodically audit tool capabilities vs. declarations

### 13.7 Topology Downgrade

- Stripping CDL declarations to enable processing in a weaker enforcement topology is a category of attack
- Signed declarations (Section 9) make stripping detectable
- Data publishers concerned about downgrade SHOULD bind covenant requirements cryptographically and SHOULD declare minimum required topology when extension vocabulary supports it

---

## 14. References

### 14.1 Normative References

- **RFC 2119**: Key words for use in RFCs to Indicate Requirement Levels
- **RFC 8259**: The JavaScript Object Notation (JSON) Data Interchange Format
- **JSON Schema**: JSON Schema Validation Specification
- **RFC-PSP-CORE**: Prompt Security Protocol Core Specification
- **RFC-PSP-MCP**: Prompt Security Protocol MCP Integration

### 14.2 Informative References — Standards

- **HL7 HCS**: HL7 Healthcare Privacy and Security Classification System, Release 1
- **HL7 V3 ActCode**: HL7 V3 Code System ActCode (`http://terminology.hl7.org/CodeSystem/v3-ActCode`), including the RefrainPolicy and ObligationPolicy value sets
- **HL7 V3 Confidentiality**: HL7 V3 Confidentiality code system (`http://terminology.hl7.org/CodeSystem/v3-Confidentiality`)
- **HL7 FHIR R5**: Fast Healthcare Interoperability Resources, Release 5, Security Labels (`meta.security`)
- **HL7 DS4P FHIR IG**: Data Segmentation for Privacy Implementation Guide for FHIR
- **W3C ODRL Information Model 2.2**: Open Digital Rights Language Information Model, W3C Recommendation, February 2018
- **W3C ODRL Vocabulary 2.2**: Open Digital Rights Language Vocabulary and Expression, W3C Recommendation, February 2018
- **W3C ODRL Common Vocabulary**: Common action and constraint vocabulary used in ODRL profiles
- **OASIS XACML 3.0**: eXtensible Access Control Markup Language, OASIS Standard
- **W3C DPV 2.0**: Data Privacy Vocabulary, W3C DPVCG
- **NIST SP 800-162**: Guide to Attribute Based Access Control (ABAC) Definition and Considerations
- **NIST AI 100-1**: Artificial Intelligence Risk Management Framework (AI RMF 1.0), January 2023
- **NIST AI 600-1**: AI RMF Generative AI Profile, July 2024
- **NIST CSF 2.0**: NIST Cybersecurity Framework Version 2.0
- **NIST SP 800-53**: Security and Privacy Controls for Information Systems and Organizations
- **EU AI Act**: Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence
- **GDPR**: Regulation (EU) 2016/679 General Data Protection Regulation
- **ISO/IEC 42001:2023**: Information technology — Artificial intelligence — Management system
- **ISO/IEC 27001:2022**: Information security management systems
- **ISO/IEC 27701:2019**: Privacy information management
- **ISO/IEC TS 27560:2023**: Privacy technologies — Consent record information structure
- **C2PA**: Coalition for Content Provenance and Authenticity Specification
- **Creative Commons 4.0**: Attribution, ShareAlike, NonCommercial, NoDerivatives license terms

### 14.3 Informative References — Regulatory

- **HIPAA**: Health Insurance Portability and Accountability Act
- **GDPR**: General Data Protection Regulation
- **PCI-DSS**: Payment Card Industry Data Security Standard
- **SOC 2**: Service Organization Control 2
- **FERPA**: Family Educational Rights and Privacy Act
- **CCPA**: California Consumer Privacy Act
- **COPPA**: Children's Online Privacy Protection Act
- **GLBA**: Gramm-Leach-Bliley Act (US financial privacy)
- **42 CFR Part 2**: US substance use treatment confidentiality
- **GINA**: Genetic Information Nondiscrimination Act
- **Title 38 Section 7332**: US Veterans Affairs sensitive information protections
- **DPA UK**: UK Data Protection Act 2018
- **LGPD**: Brazil Lei Geral de Proteção de Dados
- **PIPEDA**: Canada Personal Information Protection and Electronic Documents Act
- **APPI**: Japan Act on the Protection of Personal Information
- **PDPA Singapore**: Singapore Personal Data Protection Act
- **PIPL**: China Personal Information Protection Law

---

## 15. Appendix A: Complete Examples

### A.1 Healthcare Patient Record (PHI)

**JSON Schema with CDL**:
```json
{
  "type": "object",
  "x-cdl-classes": "phi confidential",
  "x-cdl-covenants": "hipaa no-persist no-training healthcare-staff-only audit-required encryption-required",
  "x-cdl-signature": {
    "value": "ed25519:a1b2c3d4...",
    "algorithm": "ed25519",
    "timestamp": "2025-11-12T10:00:00Z",
    "signer": "compliance@hospital.example.com",
    "signer_role": "HIPAA Compliance Officer"
  },
  "properties": {
    "patientId": {
      "type": "string",
      "description": "Unique patient identifier"
    },
    "patientName": {
      "type": "string",
      "x-cdl-classes": "pii"
    },
    "dateOfBirth": {
      "type": "string",
      "format": "date",
      "x-cdl-classes": "pii"
    },
    "ssn": {
      "type": "string",
      "pattern": "^\\d{3}-\\d{2}-\\d{4}$",
      "x-cdl-classes": "pii",
      "x-cdl-covenants": "redaction-required-external"
    },
    "diagnosis": {
      "type": "string",
      "x-cdl-covenants": "medical-staff-only"
    },
    "medications": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "dosage": {"type": "string"},
          "frequency": {"type": "string"}
        }
      },
      "x-cdl-covenants": "pharmacy-access-required"
    },
    "insuranceInfo": {
      "type": "object",
      "x-cdl-classes": "pii financial",
      "x-cdl-covenants": "billing-staff-only no-external-transmission",
      "properties": {
        "provider": {"type": "string"},
        "policyNumber": {"type": "string"},
        "groupNumber": {"type": "string"}
      }
    },
    "publicHealthSummary": {
      "type": "string",
      "description": "De-identified aggregate statistics",
      "x-cdl-classes": "public",
      "x-cdl-covenants": "!no-persist !no-training !healthcare-staff-only"
    }
  }
}
```

**MCP Tool Using This Schema**:
```json
{
  "name": "get_patient_record",
  "description": "Retrieves complete patient medical record",
  "x-cdl-capabilities": "can-process-phi logs-operations encrypts-at-rest enforces-rbac hipaa-compliant",
  "inputSchema": {
    "type": "object",
    "properties": {
      "patientId": {"type": "string"},
      "requestingUser": {"type": "string"}
    }
  },
  "outputSchema": {
    "$ref": "#/definitions/PatientRecord"
  }
}
```

**LLM Decision Example**:
```
User Request: "Email me this patient's diagnosis"

Data Covenants: no-external-transmission, healthcare-staff-only
Tool Capabilities: can-send-email

LLM Reasoning:
- no-external-transmission conflicts with can-send-email
- Cannot route PHI through email tool
- Violation detected

LLM Response:
"I cannot email this patient's diagnosis because the data has a 
no-external-transmission covenant. PHI cannot be sent via email 
per HIPAA regulations. Instead, I can:
1. Display the diagnosis here in the secure application
2. Generate a secure access link for authorized personnel
3. Store it in the encrypted patient portal"
```

### A.2 Financial Services Account Data

**JSON Schema with CDL**:
```json
{
  "type": "object",
  "x-cdl-classes": "financial pci confidential",
  "x-cdl-covenants": "pci-dss sox no-training audit-required encryption-required retention-2555-days",
  "properties": {
    "accountId": {
      "type": "string"
    },
    "accountHolder": {
      "type": "string",
      "x-cdl-classes": "pii"
    },
    "accountBalance": {
      "type": "number",
      "x-cdl-covenants": "finance-team-only"
    },
    "transactions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "transactionId": {"type": "string"},
          "amount": {"type": "number"},
          "timestamp": {"type": "string", "format": "date-time"},
          "merchantName": {"type": "string"}
        }
      }
    },
    "creditCardLast4": {
      "type": "string",
      "pattern": "^\\d{4}$",
      "x-cdl-classes": "pci",
      "x-cdl-covenants": "no-log no-persist"
    },
    "aggregateStatistics": {
      "type": "object",
      "x-cdl-classes": "internal",
      "x-cdl-covenants": "!no-training !pci-dss minimum-cohort-100",
      "properties": {
        "averageBalance": {"type": "number"},
        "transactionCount": {"type": "integer"}
      }
    }
  }
}
```

**Agent with Capabilities**:
```json
{
  "agent": {
    "name": "financial-analytics-bot",
    "description": "Analyzes account data and generates reports",
    "x-cdl-capabilities": [
      "can-write-database",
      "can-generate-pdf",
      "logs-operations",
      "creates-audit-trail",
      "encrypts-at-rest",
      "enforces-rbac",
      "pci-dss-compliant",
      "sox-compliant"
    ]
  }
}
```

**Covenant-Capability Match**:
```
Data Requirements:
- pci-dss, sox, encryption-required, audit-required

Agent Capabilities:
- pci-dss-compliant âœ“ (satisfies pci-dss covenant)
- sox-compliant âœ“ (satisfies sox covenant)
- encrypts-at-rest âœ“ (satisfies encryption-required)
- creates-audit-trail âœ“ (satisfies audit-required)

Result: Agent is compliant, can process this data
```

### A.3 Educational Records (FERPA)

**JSON Schema with CDL**:
```json
{
  "type": "object",
  "x-cdl-classes": "educational-record confidential",
  "x-cdl-covenants": "ferpa no-training audit-required parent-consent-required",
  "properties": {
    "studentId": {
      "type": "string"
    },
    "studentName": {
      "type": "string",
      "x-cdl-classes": "pii"
    },
    "dateOfBirth": {
      "type": "string",
      "format": "date",
      "x-cdl-classes": "pii"
    },
    "grades": {
      "type": "object",
      "properties": {
        "mathematics": {"type": "string"},
        "science": {"type": "string"},
        "english": {"type": "string"}
      }
    },
    "behavioralNotes": {
      "type": "string",
      "x-cdl-covenants": "counselor-only no-external-sharing"
    },
    "vaccinationStatus": {
      "type": "boolean",
      "x-cdl-classes": "phi",
      "x-cdl-covenants": "hipaa healthcare-staff-only no-persist"
    },
    "emergencyContact": {
      "type": "object",
      "x-cdl-classes": "pii",
      "x-cdl-covenants": "emergency-use-only retention-90-days",
      "properties": {
        "name": {"type": "string"},
        "phone": {"type": "string"},
        "relationship": {"type": "string"}
      }
    },
    "publicAwards": {
      "type": "array",
      "x-cdl-classes": "public",
      "x-cdl-covenants": "!ferpa !parent-consent-required !no-training",
      "items": {
        "type": "string"
      }
    }
  }
}
```

**MCP Server with Mixed Capabilities**:
```json
{
  "serverInfo": {
    "name": "student-information-system",
    "version": "3.2.0",
    "x-cdl-capabilities": "can-write-database logs-operations encrypts-at-rest enforces-rbac"
  },
  "tools": [
    {
      "name": "get_student_record",
      "description": "Retrieves student record",
      "x-cdl-capabilities": "can-process-ferpa can-process-phi"
    },
    {
      "name": "email_parent_notification",
      "description": "Sends email to parent",
      "x-cdl-capabilities": "can-send-email can-call-external-api"
    },
    {
      "name": "generate_transcript",
      "description": "Generates official transcript PDF",
      "x-cdl-capabilities": "can-generate-pdf can-write-filesystem persists-data"
    }
  ]
}
```

**Multi-Tool Routing Decision**:
```
User Request: "Get student record and email it to their parent"

Step 1: get_student_record
- Data covenants: ferpa, no-training, parent-consent-required
- Tool capabilities: can-process-ferpa, logs-operations, encrypts-at-rest
- Match: Compliant âœ“

Step 2: email_parent_notification
- Data covenants: ferpa, no-training, parent-consent-required
- Tool capabilities: can-send-email, can-call-external-api, logs-operations
- Concern: can-send-email with FERPA data

LLM Reasoning:
- FERPA allows parent access to educational records
- parent-consent-required covenant is satisfied if parent is recipient
- can-send-email is acceptable for parent communication

Result: Both tools compliant, execute workflow
```

### A.4 Multi-Tenant SaaS with Sidecar Governance

**Sidecar CDL Endpoint**:
```
GET https://governance.realflow.ai/cdl/acme-corp/customer-data-schema

Response:
{
  "schema_id": "customer-data-v2.1",
  "x-cdl-classes": "pii confidential",
  "x-cdl-covenants": [
    "gdpr",
    "ccpa",
    "no-training",
    "encryption-required",
    "audit-required",
    "retention-2555-days",
    "right-to-deletion"
  ],
  "x-cdl-signature": {
    "value": "ed25519:x1y2z3...",
    "algorithm": "ed25519",
    "timestamp": "2025-11-12T10:00:00Z",
    "signer": "compliance@acme-corp.com",
    "signer_role": "Data Protection Officer",
    "validation_endpoint": "https://governance.realflow.ai/validate"
  },
  "issued_at": "2025-11-12T10:00:00Z",
  "expires_at": "2026-11-12T10:00:00Z"
}
```

**MCP Tool References Sidecar**:
```json
{
  "name": "get_customer_profile",
  "description": "Retrieves customer profile data",
  "x-cdl-governance-url": "https://governance.realflow.ai/cdl/acme-corp/customer-data-schema",
  "x-cdl-capabilities": "can-write-database logs-operations encrypts-at-rest gdpr-compliant",
  "outputSchema": {
    "$ref": "https://api.acme-corp.com/schemas/customer-profile.json"
  }
}
```

**LLM Governance Resolution**:
```
1. LLM calls get_customer_profile tool
2. LLM sees x-cdl-governance-url in tool definition
3. LLM fetches governance from Realflow sidecar
4. LLM validates signature via validation_endpoint
5. LLM applies covenants to returned data
6. LLM enforces GDPR/CCPA covenants in subsequent operations
```

### A.5 API Gateway Injection (Azure APIM)

**APIM Policy Configuration**:
```xml
<policies>
  <inbound>
    <set-header name="X-CDL-Capabilities" exists-action="override">
      <value>can-call-external-api logs-operations persists-data</value>
    </set-header>
  </inbound>
  <outbound>
    <set-body>
      @{
        var body = context.Response.Body.As<JObject>();
        body["x-cdl-classes"] = "confidential pii";
        body["x-cdl-covenants"] = "gdpr no-training audit-required";
        body["x-cdl-capabilities"] = "can-call-external-api logs-operations persists-data";
        return body.ToString();
      }
    </set-body>
  </outbound>
</policies>
```

**Result for LLM**:
```json
{
  "customer": {
    "id": "cust_12345",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "x-cdl-classes": "confidential pii",
  "x-cdl-covenants": "gdpr no-training audit-required",
  "x-cdl-capabilities": "can-call-external-api logs-operations persists-data"
}
```

The LLM now has full visibility into:
- What the data IS (classes)
- What it MUST/MUST NOT do (covenants)
- What the backend CAN do (capabilities)

All injected transparently by infrastructure layer, no backend code changes required.

### A.6 Medical Diagnosis with Operator Visibility Control (NEW in v1.1)

**Scenario**: Physician Assistant requests diagnosis assistance, but should not see full patient medical history.

**Patient Data Schema**:
```json
{
  "type": "object",
  "x-cdl-classes": "phi patient-medical-record",
  "x-cdl-covenants": "hipaa no-persist no-training no-display-to-operator physician-only",
  "properties": {
    "patientId": {
      "type": "string"
    },
    "demographics": {
      "type": "object",
      "x-cdl-covenants": "!no-display-to-operator",
      "properties": {
        "age": {"type": "integer"},
        "gender": {"type": "string"}
      }
    },
    "medicalHistory": {
      "type": "object",
      "x-cdl-covenants": "no-display-to-operator",
      "properties": {
        "conditions": {
          "type": "array",
          "items": {"type": "string"}
        },
        "medications": {
          "type": "array",
          "items": {"type": "string"}
        },
        "labResults": {
          "type": "object",
          "properties": {
            "hba1c": {"type": "string"},
            "glucose": {"type": "string"},
            "bloodPressure": {"type": "string"}
          }
        }
      }
    },
    "visitSummary": {
      "type": "object",
      "x-cdl-covenants": "summary-only-display",
      "properties": {
        "chiefComplaint": {"type": "string"},
        "assessment": {"type": "string"}
      }
    }
  }
}
```

**Operator Context**:
```json
{
  "operator_id": "pa_smith@clinic.com",
  "operator_roles": ["physician_assistant", "clinic_staff"],
  "operator_permissions": ["view_basic_info", "document_visit"],
  "operator_clearance": "standard"
}
```

**LLM Processing**:

```
Step 1: Receive patient data in context
- patientId: "PT-12345"
- demographics.age: 58
- demographics.gender: "Male"
- medicalHistory.conditions: ["Hypertension", "Type 2 Diabetes", "MI 2018"]
- medicalHistory.medications: ["Metformin 1000mg BID", "Lisinopril 10mg QD"]
- medicalHistory.labResults: {hba1c: "8.2%", glucose: "180 mg/dL", bloodPressure: "145/92"}
- visitSummary.chiefComplaint: "Follow-up for diabetes management"

Step 2: Check operator visibility covenants
- Root covenant: no-display-to-operator physician-only
- demographics: Covenant negated (!no-display-to-operator) → CAN display
- medicalHistory: no-display-to-operator → CANNOT display
- visitSummary: summary-only-display → Can display summaries only

Step 3: Check operator role
- Required role: physician
- Operator role: physician_assistant
- Role mismatch: PA < Physician
- Restriction applies

Step 4: Process data internally
- Analyze complete medical history
- Review all lab values
- Consider medication regimen
- Evaluate cardiovascular risk
- Generate diagnosis recommendations

Step 5: Filter response for operator
```

**LLM Response to PA (Filtered)**:

```
PATIENT VISIT GUIDANCE (PT-12345)

Demographics:
- Age: 58, Male

Focus Areas for Today's Appointment:

1. DIABETES MANAGEMENT (High Priority)
   Recent lab work indicates diabetes control needs improvement. Key points:
   - Review blood glucose monitoring logs with patient
   - Assess medication adherence
   - Discuss dietary and exercise modifications
   - May require medication adjustment or specialist referral

2. BLOOD PRESSURE MONITORING (Priority)
   Blood pressure readings are above target range. Actions:
   - Review medication compliance
   - Reinforce lifestyle modifications
   - Consider medication titration

3. CARDIOVASCULAR RISK ASSESSMENT
   Given patient's cardiac history, emphasize:
   - Medication adherence (especially antiplatelet therapy)
   - Lifestyle risk factor management
   - Regular follow-up monitoring

RECOMMENDATIONS:
- Consider endocrinology referral if diabetes control doesn't improve
- Schedule 3-month follow-up
- Verify medication adherence

CLINICAL NOTES:
For specific lab values, detailed medication list, and complete medical 
history, please access the patient's chart in the EMR system. Full records 
require physician-level access.
```

**What PA Sees**: Actionable guidance without specific protected values
**What PA Does NOT See**: Specific HbA1c (8.2%), glucose (180 mg/dL), BP (145/92), full medication list

**Audit Log**:
```json
{
  "event_type": "operator_visibility_enforcement",
  "timestamp": "2025-11-13T10:30:00Z",
  "operator_id": "pa_smith@clinic.com",
  "operator_role": "physician_assistant",
  "patient_id": "PT-12345",
  "data_classification": "phi",
  "covenants_enforced": ["no-display-to-operator", "physician-only"],
  "fields_blocked": [
    "medicalHistory.conditions",
    "medicalHistory.medications",
    "medicalHistory.labResults.hba1c",
    "medicalHistory.labResults.glucose",
    "medicalHistory.labResults.bloodPressure"
  ],
  "fields_allowed": [
    "demographics.age",
    "demographics.gender"
  ],
  "summary_provided": true,
  "compliance_status": "enforced"
}
```

**Key Benefits**:
- PA receives valuable clinical guidance
- Patient privacy protected (PA can't see detailed PHI)
- LLM processes complete data for accurate analysis
- Role-based access controls enforced
- Complete audit trail maintained
- Maintains clinical utility while enforcing governance

---

## 16. Appendix B: CDL Vocabulary Reference

### B.1 Quick Reference Table

| Declaration Type | Example Terms | Attached To |
|------------------|---------------|-------------|
| `x-cdl-classes` | `phi`, `pii`, `pci`, `confidential`, `public` | Data schemas |
| `x-cdl-covenants` | `no-persist`, `no-training`, `audit-required`, `hipaa` | Data schemas |
| `x-cdl-capabilities` | `can-send-email`, `logs-operations`, `can-write-storage` | Tools, agents, servers |

### B.2 Covenant-Capability Conflict Matrix

| Covenant | Conflicts With | Rationale |
|----------|----------------|-----------|
| `no-persist` | `can-write-storage`, `logs-operations`, `persists-data`, `can-cache` | Data would be stored |
| `no-training` | `used-for-model-training`, `used-for-analytics` | Data would train models |
| `no-external-transmission` | `can-send-email`, `can-send-sms`, `can-call-external-api`, `can-post-to-web` | Data leaves boundary |
| `no-log` | `logs-operations`, `logs-data`, `creates-audit-trail` | Data appears in logs |
| `no-cache` | `can-cache` | Data would be cached |
| `encryption-required` | (absence of encryption capabilities) | Encryption not supported |
| `no-display-to-operator` | `can-display-to-operator`, `displays-raw-data` | Data would be shown to operator |
| `operator-blind-processing` | `can-display-to-operator` | Operator must not see data |
| `redacted-display-only` | `displays-raw-data` (without `supports-redaction`) | Raw data display not allowed |
| `role-restricted-display` | `can-display-to-operator` (when operator lacks required role) | Operator role insufficient |
| `no-collect` | `collects-data` | Tool would ingest prohibited data |
| `no-derived-collection` | `collects-data`, `creates-embeddings`, `indexes-for-rag` | Tool would retain derived forms |
| `no-government-disclosure` | `discloses-to-government` | Data would reach government recipient |
| `no-directory-listing` | `appears-in-directory` | Data would be listed in directory |
| `no-disclosure-to-subject` | `discloses-to-data-subject` (without `gates-subject-disclosure`) | Data would reach subject without gating |
| `no-embedding-storage` | `creates-embeddings` | Embeddings would be stored |
| `no-rag-indexing` | `indexes-for-rag` | Data would be indexed for retrieval |
| `subject-authorization-required` | (absence of `verifies-subject-authorization`) | Authorization check not performed |
| `agreement-required` | (absence of `verifies-agreement`) | Agreement check not performed |
| `agreement-required-{type}` | (absence of matching `verifies-agreement-{type}`) | Specific agreement type not verified |
| `organizational-policy-required` | (absence of `verifies-organizational-policy`) | Org policy not verified |
| `consent-current-required` | (absence of `verifies-consent-recency`) | Recency check not performed |
| `parental-consent-required` | (absence of `verifies-parental-consent`) | Parental consent not verified |
| `professional-determination-required` | (absence of `verifies-professional-determination`) | Professional authorization not verified |
| `encryption-in-use` | (absence of `encrypts-in-use` or `supports-secure-enclave`) | In-use encryption not supported |
| `de-identification-required` | (absence of `can-de-identify`) | Formal de-identification not supported |
| `delete-after-use` | (absence of `supports-deletion-after-use`) | Tool does not support delete-after-use |
| `within-jurisdiction-only` | (absence of matching `processes-in-jurisdiction-{code}`) | Tool processes outside required jurisdiction |
| `no-derive` | `can-derive` | Tool would create derivatives |
| `no-aggregate` | `can-aggregate` | Tool would aggregate data |
| `no-extract` | `can-extract` | Tool would extract portions |
| `no-index` | `can-index` | Tool would index data |
| `no-distribute` | `can-distribute` | Tool would distribute data |
| `no-share` | `can-share` | Tool would share data |
| `no-modify` | `can-modify` | Tool would modify data |
| `no-transform` | `can-transform` | Tool would transform data |
| `no-translate` | `can-translate` | Tool would translate data |
| `no-print` | `can-print` | Tool would render to print |
| `no-display` | `can-display` | Tool would display data |
| `no-execute` | `can-execute` | Tool would execute data as code |
| `no-commercial-use` | `commercial-use` | Tool operates commercially |
| `no-secondary-use` | `secondary-use` | Tool would use beyond original purpose |
| `no-tracking` | `tracks-usage` | Tool would track usage |
| `no-profiling` | `builds-profiles` | Tool would build profiles |
| `no-automated-decision-making` | `makes-automated-decisions` | Tool makes solely automated decisions |
| `attribution-required` | (absence of `preserves-attribution`) | Attribution would not be preserved |
| `share-alike-required` | (absence of `enforces-share-alike`) | Share-alike not enforced |
| `lawful-basis-consent` | (absence of `verifies-consent-record`) | Consent record not verified |
| `lawful-basis-contract` | (absence of `verifies-contract-active`) | Active contract not verified |
| `lawful-basis-legitimate-interests` | (absence of `verifies-legitimate-interest-assessment`) | LIA not verified |
| `human-oversight-required` | (absence of `provides-human-oversight`) | Human oversight not provided |
| `transparency-disclosure-required` | (absence of `discloses-ai-nature`) | AI nature not disclosed |
| `ai-generated-content-marked` | (absence of `marks-ai-generated-content`) | Outputs not marked as AI-generated |
| `explainable-ai-required` | (absence of `explainable-ai`) | AI is not explainable |
| `interpretable-ai-required` | (absence of `interpretable-ai`) | AI is not interpretable |
| `fair-bias-managed-required` | (absence of `fair-bias-managed-ai`) | Bias management not documented |
| `right-of-erasure` | (absence of `supports-right-of-erasure`) | Tool cannot perform deletion on request |
| `right-of-access` | (absence of `supports-right-of-access`) | Tool cannot produce access reports |
| `right-of-portability` | (absence of `supports-right-of-portability`) | Tool cannot export portably |
| `ai-unacceptable-risk` (classification) | `is-ai-system` | EU AI Act prohibits this AI processing entirely |
| `ai-high-risk` (classification) | `is-ai-system` (without `passed-conformity-assessment`) | High-risk AI requires conformity assessment |

### B.3 Covenant-Capability Satisfaction Matrix

| Covenant | Satisfied By | Rationale |
|----------|--------------|-----------|
| `audit-required` | `logs-operations`, `creates-audit-trail` | Logging satisfies audit |
| `encryption-required` | `encrypts-at-rest`, `encrypts-in-transit` | Encryption provided |
| `encryption-in-use` | `encrypts-in-use`, `supports-secure-enclave` | In-use encryption capability available |
| `hipaa` | `hipaa-compliant`, `can-process-phi` | HIPAA compliance |
| `gdpr` | `gdpr-compliant` | GDPR compliance |
| `42-cfr-part-2` | `42-cfr-part-2-compliant` | Substance use confidentiality compliance |
| `gina` | `gina-compliant` | Genetic information protection |
| `role-based-access` | `enforces-rbac` | RBAC enforcement |
| `mfa-required` | `enforces-mfa` | MFA enforcement |
| `redacted-display-only` | `supports-redaction` | Redaction capability available |
| `summary-only-display` | `supports-summarization` | Summarization capability available |
| `role-restricted-display` | `checks-operator-role` | Role verification capability |
| `audit-on-display` | `logs-display-events` | Display event logging |
| `subject-authorization-required` | `verifies-subject-authorization` | Subject authorization check |
| `agreement-required` | `verifies-agreement` | Agreement verification |
| `agreement-required-baa` | `verifies-agreement-baa` | BAA verification |
| `agreement-required-dua` | `verifies-agreement-dua` | DUA verification |
| `agreement-required-mou` | `verifies-agreement-mou` | MoU verification |
| `organizational-policy-required` | `verifies-organizational-policy` | Org policy attestation |
| `consent-current-required` | `verifies-consent-recency` | Consent recency check |
| `parental-consent-required` | `verifies-parental-consent` | Parental consent verification |
| `professional-determination-required` | `verifies-professional-determination` | Professional credentialing check |
| `de-identification-required` | `can-de-identify` | Formal de-identification capability |
| `delete-after-use` | `supports-deletion-after-use` | Tool deletes after first read |
| `no-disclosure-to-subject` | `gates-subject-disclosure` (when present alongside `discloses-to-data-subject`) | Tool gates disclosure to subject |
| `within-jurisdiction-only` | `processes-in-jurisdiction-{matching-code}` | Tool processes in required jurisdiction |
| `no-collect` | `transient-processing-only` | Tool does not collect |
| `no-derived-collection` | `transient-processing-only` | Tool retains nothing |
| `lawful-basis-consent` | `verifies-consent-record` | Consent record verified |
| `lawful-basis-contract` | `verifies-contract-active` | Active contract verified |
| `lawful-basis-legal-obligation` | `verifies-legal-obligation` | Legal obligation documented |
| `lawful-basis-public-task` | `verifies-public-task-authority` | Public-task authority verified |
| `lawful-basis-legitimate-interests` | `verifies-legitimate-interest-assessment` | LIA documented |
| `human-oversight-required` | `provides-human-oversight` | Human oversight implemented |
| `transparency-disclosure-required` | `discloses-ai-nature` | AI nature disclosed |
| `ai-generated-content-marked` | `marks-ai-generated-content` | Outputs marked |
| `valid-and-reliable-required` | `validated-and-reliable` | NIST AI RMF documented |
| `safe-ai-required` | `safe-ai` | Safety documented |
| `secure-resilient-ai-required` | `secure-resilient-ai` | Security documented |
| `accountable-transparent-ai-required` | `accountable-transparent-ai` | Accountability documented |
| `explainable-ai-required` | `explainable-ai` | Explainability provided |
| `interpretable-ai-required` | `interpretable-ai` | Interpretability provided |
| `privacy-enhanced-ai-required` | `privacy-enhanced-ai` | PETs documented |
| `fair-bias-managed-required` | `fair-bias-managed-ai` | Bias management documented |
| `risk-management-system-required` | `documents-risk-management-system` | RMS documented |
| `conformity-assessment-required` | `passed-conformity-assessment` | Assessment passed |
| `attribution-required` | `preserves-attribution` | Attribution preserved |
| `share-alike-required` | `enforces-share-alike` | Share-alike enforced |
| `right-of-access` | `supports-right-of-access` | Access supported |
| `right-of-erasure` | `supports-right-of-erasure` | Erasure supported |
| `right-of-portability` | `supports-right-of-portability` | Portability supported |
| `right-of-rectification` | `supports-right-of-rectification` | Rectification supported |
| `right-to-object` | `supports-right-to-object` | Objection supported |
| `eu-ai-act` | `eu-ai-act-compliant` | EU AI Act compliance documented |
| `iso-iec-42001` | `iso-iec-42001-certified` | ISO 42001 certified |
| `iso-iec-27001` | `iso-iec-27001-certified` | ISO 27001 certified |
| `nist-ai-rmf` | `nist-ai-rmf-aligned` | NIST AI RMF aligned |

### B.4 Semantic Equivalences

LLMs understand these terms as semantically related:

| Term Group | Equivalent Meanings |
|------------|---------------------|
| Storage | `persists-data`, `can-write-storage`, `can-write-database`, `can-write-filesystem` |
| Logging | `logs-operations`, `logs-data`, `creates-audit-trail` |
| External Transmission | `can-send-email`, `can-send-sms`, `can-call-external-api`, `can-post-to-web` |
| Encryption | `encrypts-at-rest`, `encrypts-in-transit`, `encrypts-in-use`, `encryption-required` |
| Health Data | `phi`, `hipaa`, `can-process-phi`, `healthcare-staff-only` |
| Personal Data | `pii`, `gdpr`, `ccpa` |
| Operator Visibility | `no-display-to-operator`, `operator-blind-processing` (equivalent prohibition); `can-display-to-operator`, `displays-raw-data` (equivalent display capability) |
| Display Control | `redacted-display-only`, `summary-only-display`, `role-restricted-display` (different levels of display restriction) |
| Subject Visibility | `no-disclosure-to-subject` (data subject must not see); distinct from operator visibility |
| Authorization Requirements | `subject-authorization-required`, `agreement-required`, `organizational-policy-required`, `consent-current-required`, `parental-consent-required`, `professional-determination-required` (each requires distinct authorization evidence) |
| Authorization Verification | `verifies-subject-authorization`, `verifies-agreement`, `verifies-organizational-policy`, `verifies-consent-recency`, `verifies-parental-consent`, `verifies-professional-determination` (the corresponding capabilities) |
| Collection Control | `no-collect`, `no-derived-collection`, `collection-purpose-limited` (different scopes of collection prohibition) |
| Sensitive Health Categories | `psychiatric-information`, `substance-use-information`, `hiv-information`, `genetic-information`, `reproductive-health-information`, `sexual-violence-information`, `minor-health-information`, `developmental-disability-information` (jurisdiction-specific protection levels apply) |
| De-identification | `anonymization-required` (general); `de-identification-required` (formal HIPAA Safe Harbor / Expert Determination methodology) |
| Deletion | `ephemeral` (delete immediately), `single-use` (use once), `delete-after-use` (delete after first complete read), `retention-{n}-days` (delete after period) |
| Legal Basis | `lawful-basis-consent`, `lawful-basis-contract`, `lawful-basis-legal-obligation`, `lawful-basis-vital-interests`, `lawful-basis-public-task`, `lawful-basis-legitimate-interests` (six GDPR Article 6 bases; processing requires at least one) |
| Purpose Categories | `purpose-service-provision`, `purpose-personalization`, `purpose-marketing`, `purpose-research`, `purpose-fraud-prevention`, `purpose-security`, `purpose-compliance`, `purpose-quality-improvement`, `purpose-public-health`, `purpose-treatment`, `purpose-payment`, `purpose-healthcare-operations` |
| ODRL Action Prohibitions | `no-derive`, `no-aggregate`, `no-extract`, `no-index`, `no-distribute`, `no-share`, `no-modify`, `no-transform`, `no-translate`, `no-print`, `no-display`, `no-execute`, `no-commercial-use`, `no-secondary-use`, `no-resale`, `no-sublicense` |
| ODRL/CC License Requirements | `attribution-required`, `share-alike-required`, `notify-on-use`, `inform-of-recipients`, `obtain-consent-each-use`, `pay-required` |
| AI Trustworthiness (NIST AI RMF) | `valid-and-reliable-required`, `safe-ai-required`, `secure-resilient-ai-required`, `accountable-transparent-ai-required`, `explainable-ai-required`, `interpretable-ai-required`, `privacy-enhanced-ai-required`, `fair-bias-managed-required` |
| EU AI Act Risk Tiers | `ai-unacceptable-risk` (prohibited), `ai-high-risk` (regulated), `ai-limited-risk` (transparency), `ai-minimal-risk` (unregulated); plus `ai-gpai-model`, `ai-gpai-systemic-risk` |
| EU AI Act Obligations | `human-oversight-required`, `transparency-disclosure-required`, `ai-generated-content-marked`, `risk-management-system-required`, `conformity-assessment-required`, `fundamental-rights-impact-assessed` |
| GDPR Data Subject Rights | `right-of-access`, `right-of-rectification`, `right-of-erasure`, `right-of-portability`, `right-of-restriction`, `right-to-object`, `right-not-to-be-subject-to-automated-decisions`, `right-to-explanation` |
| Tracking and Profiling | `no-tracking`, `no-profiling`, `no-automated-decision-making`, `accept-tracking-consent-required` |
| AI/Synthetic Content Markers | `ai-generated`, `ai-assisted`, `synthetic-media`, `deepfake` (classifications); `produces-synthetic-media`, `marks-ai-generated-content`, `signs-output-provenance`, `embeds-watermark` (capabilities) |

---

## 17. Appendix C: HL7 Term Mapping

This appendix provides a complete mapping between CDL vocabulary and HL7 Healthcare Privacy and Security Classification System (HCS) codes. As of CDL v1.3, every HL7 RefrainPolicy, ObligationPolicy, Confidentiality, and primary InformationSensitivityPolicy code has a direct CDL equivalent. Implementations operating in healthcare contexts MAY use either CDL native vocabulary or HL7 codes referenced via canonical URIs; both forms are normative and interchangeable.

The HL7 system URIs are:
- `http://terminology.hl7.org/CodeSystem/v3-ActCode` for ActCode-derived values (RefrainPolicy, ObligationPolicy)
- `http://terminology.hl7.org/CodeSystem/v3-Confidentiality` for Confidentiality codes

CDL implementations SHOULD support a binding mode that accepts HL7 codes directly in `x-cdl-classes` and `x-cdl-covenants` arrays, either as bare HL7 codes (`NORDSCLCD`) or as full URIs (`http://terminology.hl7.org/CodeSystem/v3-ActCode#NORDSCLCD`).

### C.1 Confidentiality Mapping

CDL v1.3 provides full coverage of the HL7 Confidentiality six-level total-order hierarchy.

| CDL Class | HL7 Confidentiality Code | HL7 Display |
|---|---|---|
| `public` | `U` | Unrestricted |
| `low` | `L` | Low |
| `internal` | `M` | Moderate |
| `normal` | `N` | Normal |
| `confidential`, `restricted` | `R` | Restricted |
| `secret` | `V` | Very Restricted |

Both `internal` and `normal` map to HL7 codes (`M` and `N` respectively). Implementations choose between them based on deployment context: `internal` for general business contexts, `normal` for healthcare or regulated contexts where the HL7 Normal protection level baseline applies.

### C.2 Refrain Policy Mapping (Prohibitions)

CDL v1.3 provides direct equivalents for all primary HL7 RefrainPolicy codes.

| CDL Covenant | HL7 RefrainPolicy Code | HL7 Description |
|---|---|---|
| `no-external-transmission`, `no-disclose` | `NORDSCLCD` (also `NODSCLCD`) | Prohibition on redisclosure without consent directive |
| `no-persist` | `NOPERSISTP` | Prohibition on persisting data |
| `subject-authorization-required` | `NOAUTH` | Prohibition on disclosure without information subject's authorization |
| `agreement-required` | `NOMOU` | Prohibition on disclosure without a memorandum of understanding |
| `organizational-policy-required` | `NOORGPOL` | Prohibition on disclosure without organizational authorization |
| `no-disclosure-to-subject` | `NOPAT` | Information may not be disclosed to the patient/data subject |
| `no-collect` | `NOCOLLECT` | Prohibition on collection |
| `no-government-disclosure` | `NOGOV` | Prohibition on disclosure to government |
| `no-directory-listing` | `NOLIST` | Prohibition on listing in records or directories |

### C.3 Obligation Policy Mapping (Mandated Actions)

CDL v1.3 provides direct equivalents for all primary HL7 ObligationPolicy codes.

| CDL Covenant | HL7 ObligationPolicy Code | HL7 Description |
|---|---|---|
| `encryption-required` | `ENCRYPT` | Custodian must encrypt |
| `encryption-at-rest` | `ENCRYPTR` | Encrypt at rest |
| `encryption-in-transit` | `ENCRYPTT` | Encrypt in transit |
| `encryption-in-use` | `ENCRYPTU` | Encrypt during use |
| `redaction-required` | `MASK` | Mask data |
| `anonymization-required` | `ANONY` | Anonymize |
| `de-identification-required` | `DEID` | De-identify per HIPAA Safe Harbor or Expert Determination |
| `audit-required`, `audit-trail-mandatory` | `AUDIT`, `AUDTR` | Audit / maintain audit trail |
| `delete-after-use` | `DELAU` | Delete after use |
| `requires-approval` (capability) / `compliance-review-required` (covenant) | `HUMAN_APPROVED` (jurisdiction-specific) | Requires human approval |

### C.4 Information Sensitivity Mapping

HL7 InformationSensitivityPolicy codes describe specific categories of sensitive information that may carry distinct jurisdictional protection levels. CDL v1.3 provides direct equivalents for the primary sensitivity categories.

| CDL Class | HL7 InformationSensitivityPolicy Code | HL7 Description |
|---|---|---|
| `phi` | (composite) | Conveyed by HL7 Confidentiality codes (e.g., `N`) plus sensitivity tags |
| `psychiatric-information` | `PSY` | Psychiatric information |
| `substance-use-information` | `ETH`, `SUBSTANCE` | Substance use / behavioral health |
| `hiv-information` | `HIV` | HIV information |
| `genetic-information` | `GDIS` | Genetic disease information |
| `reproductive-health-information` | `SICKLE`, `STD` (related), and others | Reproductive health |
| `sexual-violence-information` | `SDV`, `SEX` (related) | Sexual / domestic violence |
| `minor-health-information` | `ADOL` | Adolescent / minor health |
| `developmental-disability-information` | `DEVEL` | Developmental disability |
| `social-services-information` | `SOC` | Social services |
| `employment-record` | `EMP` | Employment-related sensitivity |
| `taboo-information` | `TBOO` | Taboo information requiring patient-mediated disclosure |
| `directory-information` | (handled via `NOLIST` / `no-directory-listing`) | Directory listing eligibility |

HL7 explicitly notes that InformationSensitivityPolicy codes are not interoperable outside a policy domain because protection levels vary by jurisdiction. CDL implementations SHOULD treat these classifications as triggers for jurisdiction-specific policy lookup rather than as policies in themselves.

### C.5 Capability Mapping

HL7 does not define tool capability declarations as a first-class vocabulary; capability matching in HL7 deployments is performed by external XACML PDPs against externally maintained policy. CDL's `x-cdl-capabilities` vocabulary is used to satisfy or conflict with HL7-derived covenants per Appendix B matrices.

For example, an HL7 `NOMOU` (`agreement-required`) covenant on data is satisfied by a tool declaring `verifies-agreement-mou`. An HL7 `ENCRYPT` (`encryption-required`) obligation is satisfied by a tool declaring `encrypts-at-rest` and `encrypts-in-transit`. An HL7 `DELAU` (`delete-after-use`) obligation is satisfied by a tool declaring `supports-deletion-after-use`.

### C.6 CDL Concepts Without HL7 Equivalents

The following CDL vocabulary represents AI-specific governance requirements that did not exist when HL7 vocabulary was developed and have no HL7 equivalent. These remain CDL-original contributions:

**AI Training and Learning:**
- `no-training`, `no-fine-tuning`, `no-learning`, `no-embedding-storage`, `no-rag-indexing`

**Operator Visibility (LLM-as-trusted-intermediary):**
- `no-display-to-operator`, `operator-blind-processing`, `redacted-display-only`, `summary-only-display`, `role-restricted-display`, `audit-on-display`

**Tool/Agent Capability Declarations:**
- The entire `x-cdl-capabilities` vocabulary

**Schema-level attachment with hierarchical inheritance and negation:**
- The `x-cdl-*` JSON Schema binding pattern with `!` negation and parent-walking inheritance

**Multi-topology enforcement model:**
- The Topology A/B/C framework defined in Section 7.6

### C.7 Recommended Practice for Healthcare Deployments

CDL implementations operating in healthcare contexts have two equally valid binding strategies:

**Strategy 1 — Native CDL vocabulary:** Use CDL terms throughout (`no-disclosure-to-subject`, `agreement-required-baa`, `de-identification-required`, etc.). Healthcare-aware consumers MUST recognize these terms as semantically equivalent to their HL7 counterparts via this appendix. This strategy is preferred when the deploying organization is AI-first and uses CDL across both healthcare and non-healthcare data.

**Strategy 2 — HL7 binding mode:** Use HL7 codes directly in CDL declaration arrays (`hl7:NOPAT`, `hl7:NOMOU`, `hl7:DEID`). This strategy is preferred when the deploying organization is healthcare-first and already maintains FHIR-based infrastructure with HCS labeling.

Both strategies are normative and interchangeable. Mixed usage within a single declaration array is permitted; for example:

```json
{
  "x-cdl-covenants": [
    "phi",
    "hl7:NORDSCLCD",
    "no-training",
    "subject-authorization-required",
    "operator-blind-processing"
  ]
}
```

This array combines an HL7 code (`NORDSCLCD`) with native CDL terms (`subject-authorization-required` is the equivalent of `NOAUTH`; `operator-blind-processing` is CDL-original with no HL7 equivalent). LLM-based and deterministic policy decision points MUST treat the HL7 code and its CDL equivalent as identical for the purpose of conflict and satisfaction evaluation.

### C.8 Round-Trip Interoperability

A CDL declaration MAY be losslessly converted to an equivalent set of FHIR `meta.security` labels and back to CDL, provided the implementation supports the binding mode described above. This enables the following workflows:

1. **Healthcare data ingestion**: A FHIR resource with `meta.security` labels is ingested; labels are converted to equivalent CDL covenants attached to the corresponding JSON Schema.
2. **Healthcare data egress**: CDL-bearing data leaving the AI workflow is converted back to FHIR resources with `meta.security` labels for downstream healthcare systems.
3. **Cross-system policy evaluation**: A FHIR-based policy decision point and a CDL-based policy decision point evaluate the same data and reach equivalent decisions.

Implementations that perform round-trip conversion SHOULD preserve the original encoding (HL7 code or CDL term) to support audit trails that show provenance.

---

**END OF RFC-CDL v1.5**

---

## Acknowledgments

The Covenant Declaration Language was developed by RealflowCloud with contributions from the AI governance and compliance community. Special thanks to organizations pioneering governance-first AI architectures and the Model Context Protocol community for their foundational work enabling this specification.

The v1.2 alignment with HL7 Healthcare Privacy and Security Classification System acknowledges the foundational work of the HL7 Security Work Group and the Vocabulary Work Group, whose decades of effort developed the conceptual model and vocabulary that CDL extends into AI workflows.

The v1.3 vocabulary expansion to achieve full coverage of HL7 RefrainPolicy, ObligationPolicy, Confidentiality, and primary InformationSensitivityPolicy codes was undertaken to enable lossless round-trip interoperability between CDL-bearing AI workflows and FHIR-based healthcare systems.

## Change Log

**Version 1.5 (May 5, 2026)**:
- **CORRECTED**: Abstract Key Features list — old item #6 ("LLM-native semantic understanding") and item #8 (multi-topology) consolidated into a single accurate item that describes both deterministic PDP enforcement (proxied) and LLM semantic understanding (unproxied or defense-in-depth). The previous wording incorrectly implied that all CDL enforcement is semantic, contradicting Section 7.6 which defines three reference topologies including deterministic enforcement at chat host and MCP proxy tiers.
- **CORRECTED**: Abstract Design Philosophy paragraph — replaced "vocabulary that LLMs naturally understand through semantic comprehension" with framing that vocabulary is interpretable both by deterministic PDPs and by LLMs.
- **CORRECTED**: Section 1.1 Purpose — removed the absolute claim that CDL enforces "through semantic comprehension rather than rigid rule matching" and replaced with the layered enforcement model.
- **CORRECTED**: Section 1.2 closing sentence — replaced "vocabulary that LLMs naturally understand" with dual-interpretability framing.
- **CORRECTED**: Section 1.3 Design Goals — old item #2 "Semantic comprehension: LLMs understand meaning, not just syntax" replaced with "Dual interpretability"; old item #5 "Technology agnostic" replaced with "Topology agnostic" to reflect the topology-aware enforcement model; old item #6 updated to include humans, deterministic systems, and AI.
- **CORRECTED**: Section 7 introduction added — Section 7 now opens with explicit framing that covenant-capability matching can be performed deterministically by a PDP at a proxy tier, semantically by an LLM, or both layered. Sections 7.1–7.5 describe matching semantics common to all enforcement modes; Section 7.6 defines the three reference topologies.
- **CORRECTED**: Section 7.1 retitled from "LLM-Based Semantic Matching" to "Semantic Matching Model" and rewritten to position the matching semantics as common to both deterministic and semantic enforcement, with explicit reference to Appendix B as the normative source for deterministic implementations.
- **CORRECTED**: Section 2 terminology — "Semantic Understanding" and "Covenant-Capability Matching" definitions updated to acknowledge both LLM and deterministic PDP enforcement layers.
- **RATIONALE**: v1.4 added extensive non-HL7 standards coverage but inherited from v1.1 several abstract and introductory passages that framed CDL enforcement as inherently LLM-semantic. This contradicted the topology model formalized in Section 7.6 (added in v1.2), which makes deterministic enforcement at proxy tiers the primary mechanism in Topologies B and C, with LLM semantic matching as defense-in-depth. v1.5 reconciles the abstract, introduction, terminology, and Section 7.1 with the topology model so that the document is internally consistent. No vocabulary is changed; only framing and prose around enforcement architecture.

**Version 1.4 (May 5, 2026)**:
- **NEW**: AI System Risk Classifications aligned with EU AI Act four-tier framework: `ai-unacceptable-risk`, `ai-high-risk`, `ai-limited-risk`, `ai-minimal-risk`, plus `ai-gpai-model` and `ai-gpai-systemic-risk`
- **NEW**: Generated/Synthetic Content classifications: `ai-generated`, `ai-assisted`, `synthetic-media`, `deepfake`
- **NEW**: Legal Basis Declaration covenants aligned with W3C DPV and GDPR Article 6: `lawful-basis-consent`, `lawful-basis-contract`, `lawful-basis-legal-obligation`, `lawful-basis-vital-interests`, `lawful-basis-public-task`, `lawful-basis-legitimate-interests`, plus Article 9 special-category bases
- **NEW**: Standardized Purpose Limitation values aligned with W3C DPV: `purpose-service-provision`, `purpose-personalization`, `purpose-marketing`, `purpose-research`, `purpose-fraud-prevention`, `purpose-security`, `purpose-compliance`, `purpose-quality-improvement`, `purpose-public-health`, `purpose-treatment`, `purpose-payment`, `purpose-healthcare-operations`
- **NEW**: ODRL-Aligned Prohibited Action covenants: `no-derive`, `no-aggregate`, `no-extract`, `no-index`, `no-distribute`, `no-share`, `no-modify`, `no-transform`, `no-translate`, `no-print`, `no-display`, `no-execute`, `no-commercial-use`, `no-secondary-use`, `no-resale`, `no-sublicense`, `no-watermark-removal`
- **NEW**: ODRL/Creative Commons Required Action and Attribution covenants: `attribution-required`, `share-alike-required`, `notify-on-use`, `inform-of-recipients`, `obtain-consent-each-use`, `pay-required`, `review-before-publish`
- **NEW**: AI Trustworthiness Requirements aligned with NIST AI RMF and EU AI Act: `valid-and-reliable-required`, `safe-ai-required`, `secure-resilient-ai-required`, `accountable-transparent-ai-required`, `explainable-ai-required`, `interpretable-ai-required`, `privacy-enhanced-ai-required`, `fair-bias-managed-required`, `human-oversight-required`, `transparency-disclosure-required`, `ai-generated-content-marked`, `risk-management-system-required`, `conformity-assessment-required`, `fundamental-rights-impact-assessed`
- **NEW**: Data Subject Rights covenants aligned with GDPR Chapter III and W3C DPV: `right-of-access`, `right-of-rectification`, `right-of-erasure`, `right-of-portability`, `right-of-restriction`, `right-to-object`, `right-not-to-be-subject-to-automated-decisions`, `right-to-explanation`
- **NEW**: Tracking and Profiling covenants: `no-tracking`, `no-profiling`, `no-automated-decision-making`, `accept-tracking-consent-required`
- **NEW**: International regulatory framework covenants: `eu-ai-act`, `iso-iec-42001`, `iso-iec-27001`, `iso-iec-27701`, `nist-ai-rmf`, `nist-csf`, `nist-800-53`, `glba`, `dpa-uk`, `lgpd`, `pipeda`, `appi`, `pdpa-singapore`, `pipl`
- **NEW**: Legal Basis Verification capabilities: `verifies-lawful-basis`, `verifies-consent-record`, `verifies-contract-active`, `verifies-legal-obligation`, `verifies-public-task-authority`, `verifies-legitimate-interest-assessment`
- **NEW**: AI Processing Capabilities: `is-ai-system`, `is-gpai-model`, `is-high-risk-ai`, `validated-and-reliable`, `safe-ai`, `secure-resilient-ai`, `accountable-transparent-ai`, `explainable-ai`, `interpretable-ai`, `privacy-enhanced-ai`, `fair-bias-managed-ai`, `provides-human-oversight`, `discloses-ai-nature`, `marks-ai-generated-content`, `documents-risk-management-system`, `passed-conformity-assessment`, `fundamental-rights-impact-assessed`, `produces-confabulations`
- **NEW**: Content Provenance and Watermarking capabilities: `signs-output-provenance`, `embeds-watermark`, `produces-synthetic-media`, `preserves-attribution`, `enforces-share-alike`
- **NEW**: Data Subject Rights Support capabilities: `supports-right-of-access`, `supports-right-of-erasure`, `supports-right-of-portability`, `supports-right-of-rectification`, `supports-right-to-object`
- **NEW**: ODRL-Aligned Action Capabilities: `can-derive`, `can-extract`, `can-index`, `can-distribute`, `can-share`, `can-modify`, `can-transform`, `can-translate`, `can-print`, `can-display`, `can-execute`, `commercial-use`, `secondary-use`, `tracks-usage`, `builds-profiles`, `makes-automated-decisions`
- **NEW**: International Compliance capabilities: `eu-ai-act-compliant`, `iso-iec-42001-certified`, `iso-iec-27001-certified`, `iso-iec-27701-certified`, `nist-ai-rmf-aligned`, `nist-csf-aligned`, `nist-800-53-controls-implemented`, `c2pa-compliant`
- **NEW**: Section 12.7 EU Artificial Intelligence Act, Section 12.8 NIST AI Risk Management Framework, Section 12.9 ISO/IEC 42001 and Related ISO Standards, Section 12.10 Creative Commons and Content Licensing, Section 12.11 C2PA Content Provenance
- **UPDATED**: Section 12.3 (ODRL relationship) and Section 12.5 (DPV relationship) revised to reflect native CDL coverage of ODRL action vocabulary and DPV legal bases, purposes, rights, and TOMs
- **UPDATED**: Section 12.13 Summary table expanded with all standards and explicit coverage notation
- **UPDATED**: Conflict matrix (B.2), satisfaction matrix (B.3), and semantic equivalences (B.4) extended with all v1.4 covenants and capabilities
- **UPDATED**: Section 14 References expanded with EU AI Act, NIST AI 100-1, NIST AI 600-1, NIST CSF 2.0, NIST SP 800-53, ISO/IEC 42001, ISO/IEC 27001, ISO/IEC 27701, C2PA, Creative Commons, plus international privacy regulations (DPA UK, LGPD, PIPEDA, APPI, PDPA Singapore, PIPL)
- **RATIONALE**: v1.3 closed HL7 vocabulary gaps. v1.4 closes the remaining major gaps from non-HL7 standards: W3C ODRL action vocabulary, W3C DPV legal bases and rights, EU AI Act risk tiers and obligations, NIST AI RMF trustworthiness characteristics, ISO/IEC 42001/27001/27701 framework declarations, Creative Commons licensing terms, and C2PA content provenance. CDL v1.4 now provides a unified governance vocabulary that covers healthcare (HL7), privacy (DPV/GDPR), digital rights (ODRL/CC), AI risk (NIST AI RMF/EU AI Act), and content provenance (C2PA) in a single declaration array. A typical enterprise CDL declaration may now express HIPAA covenants, GDPR legal bases, EU AI Act risk classifications, and NIST AI RMF trustworthiness requirements simultaneously, with each covenant evaluated against tool capabilities at the appropriate enforcement layer.

**Version 1.3 (May 5, 2026)**:
- **NEW**: Confidentiality classifications `low` and `normal`, completing alignment with the HL7 Confidentiality six-level hierarchy
- **NEW**: Clinical sensitivity classifications: `psychiatric-information`, `substance-use-information`, `hiv-information`, `genetic-information`, `reproductive-health-information`, `sexual-violence-information`, `minor-health-information`, `developmental-disability-information`, `social-services-information`, `taboo-information`, `directory-information`
- **NEW**: Collection control covenants: `no-collect`, `no-derived-collection`, `collection-purpose-limited` (HL7 NOCOLLECT semantics)
- **NEW**: Disclosure control covenants: `no-government-disclosure` (HL7 NOGOV), `no-directory-listing` (HL7 NOLIST), `no-disclosure-to-subject` (HL7 NOPAT)
- **NEW**: Authorization requirement covenants: `subject-authorization-required` (HL7 NOAUTH), `agreement-required` and typed variants (HL7 NOMOU), `organizational-policy-required` (HL7 NOORGPOL), `consent-current-required`, `parental-consent-required`, `professional-determination-required`
- **NEW**: De-identification and encryption covenants: `de-identification-required` (HL7 DEID), `encryption-in-use` (HL7 ENCRYPTU), `delete-after-use` (HL7 DELAU)
- **NEW**: AI-specific covenants: `no-embedding-storage`, `no-rag-indexing`
- **NEW**: Regulatory framework covenants: `42-cfr-part-2`, `gina`, `title-38-section-7332`
- **NEW**: Capabilities for collection and disclosure: `collects-data`, `collects-derived-only`, `transient-processing-only`, `discloses-to-government`, `appears-in-directory`, `discloses-to-data-subject`, `gates-subject-disclosure`
- **NEW**: Capabilities for authorization verification: `verifies-subject-authorization`, `verifies-agreement` and typed variants, `verifies-organizational-policy`, `verifies-consent-recency`, `verifies-parental-consent`, `verifies-professional-determination`
- **NEW**: Capabilities for processing modes: `can-de-identify`, `encrypts-in-use`, `supports-secure-enclave`, `supports-deletion-after-use`, `processes-in-jurisdiction-{code}`, `creates-embeddings`, `indexes-for-rag`
- **NEW**: Compliance capabilities: `42-cfr-part-2-compliant`, `gina-compliant`
- **UPDATED**: Conflict matrix (B.2) extended with all v1.3 covenants and capabilities
- **UPDATED**: Satisfaction matrix (B.3) extended with all v1.3 covenants and capabilities
- **UPDATED**: Semantic equivalences (B.4) extended with new covenant groups
- **REWRITTEN**: Appendix C HL7 Term Mapping is now a complete bidirectional mapping with no documented gaps in either direction (CDL→HL7 or HL7→CDL) for primary HL7 vocabulary
- **NEW**: Section C.7 Recommended Practice for Healthcare Deployments documents two equally valid binding strategies (native CDL vocabulary or HL7 binding mode) and permits mixed usage within a single declaration array
- **NEW**: Section C.8 Round-Trip Interoperability describes lossless conversion between CDL declarations and FHIR `meta.security` labels
- **UPDATED**: Section 12.2 (HL7 relationship) revised to describe full coverage and bidirectional interoperability
- **RATIONALE**: v1.2 documented HL7 vocabulary gaps and recommended HL7-binding fallback for unsupported concepts. v1.3 closes those gaps natively, enabling CDL deployments to provide HL7-equivalent governance semantics without requiring HL7 binding for any common scenario, while preserving HL7 binding as an interoperability option. This positions CDL as a complete governance vocabulary for AI workflows that is bidirectionally interoperable with the HL7 healthcare ecosystem.

**Version 1.2 (May 5, 2026)**:
- **NEW**: Section 7.6 Enforcement Topologies, defining three reference deployment topologies (Direct LLM, Chat-Host Proxied, Full Proxy Chain) with explicit enforcement guarantees for each
- **NEW**: Section 12 Relationship to Existing Standards, formally aligning CDL with HL7 HCS, W3C ODRL, OASIS XACML, W3C DPV, NIST RBAC, and AI training opt-out conventions
- **NEW**: Section 13.7 Topology Downgrade security consideration
- **NEW**: Appendix C HL7 Term Mapping, providing normative mapping from CDL terms to HL7 Confidentiality, RefrainPolicy, ObligationPolicy, and InformationSensitivityPolicy codes, plus identification of concept gaps in both directions
- **UPDATED**: Section 7 renamed to "Covenant-Capability Matching and Enforcement Topologies"
- **UPDATED**: Section 13 (formerly Section 12) Security Considerations, with revised LLM Jailbreaking guidance referencing the new topology framework
- **UPDATED**: Section 14 References expanded with normative HL7, ODRL, XACML, DPV, NIST, and ISO standards
- **RATIONALE**: v1.1 understated CDL's enforcement story by suggesting LLM semantic matching was the primary or sole enforcement mechanism. In Realflow-style proxied deployments, deterministic enforcement at the chat host and MCP proxy layers provides guarantees comparable to traditional XACML PDPs. v1.2 also formalizes the inheritance relationship to HL7 HCS vocabulary, which has covered confidentiality classification, prohibitions, and obligations in healthcare for over a decade. Positioning CDL as the AI-native, JSON-Schema-bound, multi-topology evolution of this lineage is more honest and more credible than presenting it as parallel reinvention.

**Version 1.1 (November 13, 2025)**:
- **NEW**: Operator visibility covenants (`no-display-to-operator`, `operator-blind-processing`, `redacted-display-only`, `summary-only-display`, `role-restricted-display`, `audit-on-display`)
- **NEW**: Display-related capabilities (`can-display-to-operator`, `displays-raw-data`, `supports-redaction`, `supports-summarization`, `checks-operator-role`, `logs-display-events`)
- **NEW**: Section 7.4 Examples 4-6 demonstrating operator visibility enforcement
- **UPDATED**: Conflict matrix (B.2) with operator visibility conflicts
- **UPDATED**: Satisfaction matrix (B.3) with display-related requirements
- **UPDATED**: Semantic equivalences (B.4) with operator visibility groups
- **RATIONALE**: Addresses critical use case where LLM acts as trusted intermediary, processing data that current operator is not authorized to view directly (e.g., medical diagnosis assistance, financial analysis, security incident response)

**Version 1.0 (November 12, 2025)**:
- Initial specification
- Three declaration types: classes, covenants, capabilities
- Dual format support (string and array)
- Negation syntax
- Multiple discovery patterns
- Standard vocabulary
- Signature support
- Complete examples

## License

This specification is dedicated to the public domain under CC0 1.0 Universal at the direction of its originating author. See ../../LICENSES/CC0-1.0.txt and ../../LICENSING.md. Attribution to RealflowCloud, Inc. is appreciated but is not required by CC0.
