import { memo } from "react"
import MarkdownBlock from "../common/MarkdownBlock"

export const MarkdownRow = memo(
	({ markdown, showCursor, isStreaming }: { markdown?: string; showCursor?: boolean; isStreaming?: boolean }) => {
		return (
			<div className="wrap-anywhere overflow-hidden [&_p]:mb-0">
				<MarkdownBlock markdown={markdown} showCursor={showCursor} isStreaming={isStreaming} />
			</div>
		)
	},
)

MarkdownRow.displayName = "MarkdownRow"
