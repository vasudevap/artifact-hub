# Minimum Artifact Library

This reference defines the minimum artifact set for ArtifactHub's library when the goal is to support a project from idea through closure with enough structure for PMO governance, business analysis rigor, and solution architecture control.

## Selection logic

The library is intentionally lean. It does not try to mirror every possible PMBOK, BABOK, or TOGAF work product as a separate template. Instead, it includes the minimum logically necessary artifacts needed to:

- justify and authorize the work,
- define scope and requirements clearly,
- control delivery and change,
- define and govern the solution architecture,
- validate outcomes before release,
- close the work with reusable knowledge.

## Baseline artifact set

1. Business Case
   Why it is included: PMBOK treats the business case as a key business document, and IIBA strategy analysis also starts from defining the change and expected value.

2. Project Charter
   Why it is included: PMI identifies the charter as the formal authorization for the project and the starting point for aligned delivery.

3. Stakeholder Register and Engagement Plan
   Why it is included: Both PM and BA practice require explicit identification of stakeholders, their concerns, and how they will be engaged.

4. Integrated Project Plan
   Why it is included: A project needs a working plan for governance, milestones, controls, and execution cadence even when subsidiary plans are kept lightweight.

5. Scope Statement and Deliverables Baseline
   Why it is included: PMBOK emphasizes the scope statement, major deliverables, exclusions, and acceptance criteria as the foundation for controlling scope.

6. Requirements Package / BRD
   Why it is included: IIBA centers business analysis on eliciting, analyzing, and documenting business, stakeholder, and solution requirements.

7. Requirements Traceability Matrix
   Why it is included: PMBOK and IIBA both stress maintaining requirements through the lifecycle so they can be linked to objectives, design, delivery, and testing.

8. RAID Log
   Why it is included: Risks, assumptions, issues, and dependencies must be managed continuously to keep delivery predictable.

9. Change and Decision Log
   Why it is included: Projects need an auditable record of material decisions and approved scope or delivery changes.

10. Architecture Vision
    Why it is included: TOGAF Phase A starts by establishing the architecture project, scope, stakeholders, concerns, and the target vision.

11. Architecture Requirements Specification
    Why it is included: Architecture-significant requirements, constraints, and quality attributes must be explicit before solution design is locked in.

12. Solution Architecture Definition
    Why it is included: TOGAF architecture work produces detailed architecture descriptions that cover the target solution across key viewpoints.

13. Transition and Migration Plan
    Why it is included: TOGAF migration planning and PM delivery practice both require a deliberate path from design to rollout and operational readiness.

14. Test and Acceptance Plan
    Why it is included: Requirements and architecture only matter if the team can verify coverage and obtain formal business acceptance.

15. Closure Report and Lessons Learned
    Why it is included: PMBOK closeout guidance includes final reporting, transition, and lessons learned so value can be sustained and future work improved.

## What is intentionally not separate

The following are still important, but are consolidated into the baseline set above so the library stays practical for an MVP:

- communications planning is folded into the stakeholder artifact and integrated project plan,
- issue tracking is folded into the RAID log,
- schedule and milestone planning is folded into the integrated project plan,
- detailed data, integration, and deployment views are folded into the solution architecture definition unless the project needs them as standalone artifacts,
- benefits tracking beyond delivery is referenced in the business case and closure report.

## Standards and source anchors

- PMI PMBOK Guide page states the guide covers governance, scope, schedule, finance, stakeholders, resources, and risk, which supports the PM control artifacts in this set.
- PMI's models, methods, and artifacts reference explicitly lists sample artifacts such as project charter, risk register, and stakeholder engagement plan.
- PMBOK 6th edition errata pages list business case and benefits management plan as business documents, and list project charter, requirements documentation, requirements traceability matrix, risk register, stakeholder register, lessons learned register, and final report among core project documents.
- IIBA's Business Analysis Standard organizes work across planning and monitoring, elicitation and collaboration, strategy analysis, requirements analysis and design definition, requirements and designs life cycle management, and solution evaluation.
- IIBA also notes that some business analysis task outputs are essential inputs to later tasks, reinforcing the need for explicit artifact continuity.
- The Open Group states that TOGAF provides template deliverables for commonly used architecture deliverables.
- TOGAF guidance describes Phase A as establishing the architecture project and producing the architecture vision, and identifies later phases that produce detailed architecture descriptions, migration planning, and architecture governance outputs.

## Source links

- PMI PMBOK Guide: https://www.pmi.org/standards/pmbok
- PMI Models, Methods, and Artifacts: https://www.pmi.org/-/media/pmi/documents/public/pdf/pmbok-standards/pmi-models-methods-artifacts.pdf
- PMI PMBOK 6th edition errata PDF: https://www.pmi.org/-/media/pmi/documents/public/pdf/pmbok-standards/pmbok-guide-6th-edition-errata-4th-printing.pdf
- IIBA Business Analysis Standard tasks: https://www.iiba.org/knowledgehub/business-analysis-standard/4-tasks-and-knowledge-areas/introducing-business-analysis-tasks/
- IIBA Business Analysis Standard PDF: https://www.iiba.org/globalassets/business-analysis-resources/the-business-analysis-standard/files/the-business-analysis-standard.pdf
- The Open Group TOGAF template deliverables note: https://help.opengroup.org/hc/en-us/articles/21726647171730-Are-There-Any-Template-Deliverables-for-the-TOGAF-Standard
- The Open Group TOGAF ADM I/O descriptions: https://www.opengroup.org/architecture/togaf7-doc/arch/p2/p2_ios.htm
- The Open Group TOGAF Architecture Vision guidance: https://www.opengroup.org/architecture/0210can/togaf8/doc-review/togaf8cr/c/p2/p2_a_vision.htm
