import * as vscode from "vscode"
import { state } from "../state.js"
import structuredClonePolyfill from "@ungap/structured-clone"
import type { IdeExtensionConfigSchema } from "../api.js"
import type { MessageLintReport } from "@inlang/app"

// polyfilling node < 17 with structuredClone
if (typeof structuredClone === "undefined") {
	;(globalThis as any).structuredClone = structuredClonePolyfill
}

export async function linterDiagnostics(args: { context: vscode.ExtensionContext }) {
	const linterDiagnosticCollection = vscode.languages.createDiagnosticCollection("inlang-lint")

	async function updateLintDiagnostics() {
		const activeTextEditor = vscode.window.activeTextEditor
		if (!activeTextEditor) {
			return
		}

		const ideExtension = state().inlang.appSpecificApi()["inlang.app.ideExtension"] as
			| IdeExtensionConfigSchema
			| undefined

		if (!ideExtension) {
			return
		}

		// init lint
		await state().inlang.lint.init()

		// get lint report
		const reports = state().inlang.lint.reports()
		const diagnostics: vscode.Diagnostic[] = []

		const wrappedLints = (ideExtension.messageReferenceMatchers ?? []).map(async (matcher) => {
			const messages = await matcher({
				documentText: activeTextEditor.document.getText(),
			})
			for (const message of messages) {
				// TODO: Can be improved with lintReport exposing the messageId
				const matchingLintReports = reports.filter(
					(report) => (report.messageId = message.messageId),
				)

				for (const report of matchingLintReports) {
					const { level } = report

					const diagnosticRange = new vscode.Range(
						new vscode.Position(
							message.position.start.line - 1,
							message.position.start.character - 1,
						),
						new vscode.Position(message.position.end.line - 1, message.position.end.character - 1),
					)

					const sourceLanguageTag = state().inlang.config().sourceLanguageTag

					// Get the lint message for the source language tag or fallback to "en"
					// @ts-ignore // TODO: Fix this with proper type
					const lintMessage = report.body[sourceLanguageTag] || report.body.en

					const diagnostic = new vscode.Diagnostic(
						diagnosticRange,
						`[${message.messageId}] – ${lintMessage}`,
						mapLintLevelToSeverity(level),
					)

					diagnostics.push(diagnostic)
				}
			}
		})

		await Promise.all(wrappedLints || [])

		// Set all the collected diagnostics at once
		linterDiagnosticCollection.set(activeTextEditor.document.uri, diagnostics)
	}

	function mapLintLevelToSeverity(level: MessageLintReport["level"]): vscode.DiagnosticSeverity {
		if (level === "error") {
			return vscode.DiagnosticSeverity.Error
		} else if (level === "warning") {
			return vscode.DiagnosticSeverity.Warning
		}
		return vscode.DiagnosticSeverity.Error
	}

	// in case the active text editor is already open, update lints
	updateLintDiagnostics()

	// immediately update lints when the active text editor changes
	vscode.window.onDidChangeActiveTextEditor(
		() => updateLintDiagnostics(),
		undefined,
		args.context.subscriptions,
	)

	// update lints when the text changes in a document
	vscode.workspace.onDidChangeTextDocument(
		(event) => {
			if (event.document === vscode.window.activeTextEditor?.document) {
				updateLintDiagnostics()
			}
		},
		undefined,
		args.context.subscriptions,
	)
}
