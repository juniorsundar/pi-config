---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. The aim is leverage for callers, locality for maintainers, and testability for everyone.

This skill is a thin entry point. The canonical glossary, principles, and design processes live alongside the `improve-codebase-architecture` skill — load them from there rather than carrying a second copy that would drift.

## Vocabulary and principles

The glossary (**Module**, **Interface**, **Implementation**, **Depth**, **Seam**, **Adapter**, **Leverage**, **Locality**) and the design principles (deletion test, the interface is the test surface, one adapter = hypothetical seam) are defined once in [../improve-codebase-architecture/LANGUAGE.md](../improve-codebase-architecture/LANGUAGE.md).

Use these terms exactly — don't substitute "component," "service," "API," or "boundary." Consistent language is the whole point.

## Deepening a cluster

When deepening shallow modules into a deep one, classify each dependency (in-process, local-substitutable, remote-but-owned, true external) to decide whether the seam needs a port and how to test across it. See [../improve-codebase-architecture/DEEPENING.md](../improve-codebase-architecture/DEEPENING.md).

## Designing the interface

When exploring alternative interfaces for a deepened module, generate several radically different designs in parallel and compare them on depth, locality, and seam placement. This is the "Design It Twice" pattern. See [../improve-codebase-architecture/INTERFACE-DESIGN.md](../improve-codebase-architecture/INTERFACE-DESIGN.md).

## Harness note

The referenced files are harness-agnostic. They map parallel design work to whatever subagents the current harness exposes — in Pi, dispatch `planner` (or `worker` with a design-only brief) subagents in parallel and keep synthesis on the main thread.