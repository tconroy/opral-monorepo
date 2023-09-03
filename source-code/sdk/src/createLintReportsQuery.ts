import { createEffect } from "./reactivity/solid.js"
import { createSubscribable } from "./openInlangProject.js"
import type { InlangProject, InstalledLintRule, LintReportsQueryApi } from "./api.js"
import type { ProjectConfig } from "@inlang/project-config"
import type { ResolveModuleFunction } from "./resolve-modules/index.js"
import type { JSONObject, LintReport, LintRule, Message } from "./interfaces.js"
import { lintSingleMessage } from "./lint/index.js"
import { ReactiveMap } from "./reactivity/map.js"

/**
 * Creates a reactive query API for messages.
 */
export function createLintReportsQuery(
	messages: () => Array<Message> | undefined,
	config: () => ProjectConfig | undefined,
	installedLintRules: () => Array<InstalledLintRule>,
	resolvedModules: () => Awaited<ReturnType<ResolveModuleFunction>> | undefined,
): InlangProject["query"]["lintReports"] {
	// @ts-expect-error
	const index = new ReactiveMap<LintReport["messageId"], LintReport[]>()

	createEffect(() => {
		const msgs = messages()
		const conf = config()
		const modules = resolvedModules()

		if (msgs && conf && modules) {
			// console.log("new calculation")
			// index.clear()
			for (const message of msgs) {
				// TODO: only lint changed messages and update arrays selectively

				lintSingleMessage({
					sourceLanguageTag: conf.sourceLanguageTag,
					languageTags: conf.languageTags,
					lintRuleSettings: conf.settings as Record<LintRule["meta"]["id"], JSONObject>,
					lintLevels: Object.fromEntries(
						installedLintRules().map((rule) => [rule.meta.id, rule.lintLevel]),
					),
					messages: msgs,
					message: message,
					lintRules: modules.lintRules,
				}).then((report) => {
					if (
						report.errors.length === 0 &&
						JSON.stringify(index.get(message.id)) !== JSON.stringify(report.data)
					) {
						index.set(message.id, report.data || [])
					}
				})
			}
		}
	})

	const get = (args: Parameters<LintReportsQueryApi["get"]>[0]) => {
		return structuredClone(index.get(args.where.messageId))
	}

	return {
		getAll: createSubscribable(() => {
			return structuredClone(
				[...index.values()].flat().length === 0 ? undefined : [...index.values()].flat(),
			)
		}),
		get: Object.assign(get, {
			subscribe: (
				args: Parameters<LintReportsQueryApi["get"]["subscribe"]>[0],
				callback: Parameters<LintReportsQueryApi["get"]["subscribe"]>[1],
			) => createSubscribable(() => get(args)).subscribe(callback),
		}) as any,
	}
}
