# EpiphanyV2 Project TODO

## Database & Backend
- [x] Design and create database schema (topics, viewpoints, votes, comments)
- [x] Push database migrations
- [x] Create tRPC routers for topics, viewpoints, votes
- [ ] Implement LLM integration for AI analysis

## Frontend - Core Pages
- [x] Implement minimalist homepage
- [x] Implement topic discussion page with sunburst chart
- [x] Implement dynamic adaptive layout (hover to expand)
- [x] Implement white-label experience (minimal header)

## Frontend - Components
- [x] Create Sunburst chart component with D3.js
- [x] Create rich text editor with TipTap
- [x] Create tooltip/card for viewpoint preview
- [x] Create quadratic voting component
- [ ] Create AI report modal/page

## Styling
- [x] Configure color system (warm beige/cream theme)
- [x] Configure typography (Source Serif Pro + Inter)
- [ ] Apply design tokens throughout components

## Testing
- [x] Write vitest tests for core procedures

## User Feedback Updates
- [x] Remove text labels from sunburst chart
- [x] Show larger info card on hover instead of small tooltip

## User Feedback - UI/UX Improvements
- [x] Fix dynamic layout mouse response (left/right hover expansion)
- [x] Fix sunburst overlapping right panel when viewpoint selected
- [x] Remove logo icon from header, add "Hosted by Epiphany" at bottom in gray
- [x] Remove user avatar/credits display from header (find subtle alternative)
- [x] Move quadratic voting to bottom area (below content, above reply editor)

## Visual Style Redesign (Based on Reference)
- [x] Update color scheme: warm beige/cream background, muted browns and blue-grays
- [x] Redesign sunburst chart with academic color palette (browns, blues, grays)
- [x] Implement three-column layout: sunburst explorer + article content + thread context
- [x] Add "Topic Explorer" header with filter tabs (Relevance, Date, Consensus)
- [x] Style content area with academic paper look (marginal notes, citations)
- [x] Add Thread Context sidebar with comments and Personal Notes
- [x] Update rich text editor with AI Summary and AI Critique buttons
- [x] Apply serif fonts for headings, clean typography throughout

## UI Cleanup Based on User Feedback
- [x] Remove Thread Context sidebar (right column)
- [x] Remove user avatar and notification icon from header
- [x] Add "Hosted by Epiphany" in gray at bottom of page
- [x] Move user login status to inconspicuous location (bottom footer)
- [x] Remove notification button
- [x] Remove AI Critique button
- [x] Remove text labels from sunburst outer rings (only center title)
- [x] Remove Filter tabs from Topic Explorer

## Further UI Cleanup
- [x] Remove header (Σ logo and back button)
- [x] Remove rich text toolbar from viewpoint reading page
- [x] Rename "credits" to "消耗" (cost) - simpler concept
- [x] Remove title input for replies, auto-generate from content

## Quadratic Voting Fix & AI Report
- [x] Fix quadratic voting: only positive votes (0-10), no negative/oppose votes
- [x] Implement AI report generation feature for topic consensus/divergence analysis
- [x] Move "Hosted by Epiphany" to left bottom (below report button), make it clickable to homepage

## UI/UX Fixes - Round 2
- [x] Fix RichTextEditor cursor position (should be top-left, not center)
- [x] Add Markdown syntax support to RichTextEditor (Typography extension)
- [x] Topic Explorer header: only show topic title, remove "Topic Explorer:" prefix
- [x] Click empty area in sunburst to return to root node state
- [x] Sunburst center: show topic title instead of "root"

## Sunburst Data Structure Fix
- [x] Remove theme grouping (Uncategorized), show all viewpoints directly under root node

## Dynamic Layout Interaction
- [x] Implement hover-based dynamic layout: left panel expands when mouse hovers left, right panel expands when mouse hovers right
- [x] Reduce left panel width when viewpoint is selected to give more space to right content area

## Theme Grouping Feature
- [x] Add theme field to viewpoints table in database schema (already exists)
- [x] Create API endpoint for host to assign themes to viewpoints
- [x] Update sunburst data generation to group viewpoints by theme
- [x] Add theme management UI for host (assign/edit themes)
- [x] Display themed sunburst chart with different colored sections per theme
- [x] Add theme toggle/filter in left panel

## Theme Mode Improvements
- [x] Remove top toggle buttons from left panel (全部观点/按主题分组/管理主题)
- [x] Add theme mode toggle for host at bottom left (near "Hosted by Epiphany")
- [x] Save theme mode setting to database (host-controlled)
- [x] Users see the mode set by host, no manual toggle
- [x] Theme editing appears in viewpoint detail only when theme mode is enabled

## Bug Fixes
- [x] Fix toggle switch styling - slider position not matching toggle state
- [x] Fix viewpoint title HTML parsing - display plain text only
- [x] Assign unique colors to different themes in sunburst chart for better visual distinction
- [x] Hide hover card when a node is clicked and viewpoint detail is shown
- [x] Remove rich text toolbar from viewpoint detail reading view (keep clean reading experience)
