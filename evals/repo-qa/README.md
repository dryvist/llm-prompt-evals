# Repo knowledge suite

The suite pins seven public repositories in `sources.json` and keeps 60 short
questions with source paths, line ranges, and grep literals in
`../../datasets/repo-qa/`. The cases contain 40 lookups and 20 two-file
reasoning questions. Each question is expanded to both context sizes.

From the repository root, build the source snapshots and packed contexts with
one command:

```sh
direnv exec . node scripts/pack_repo_qa.mjs
```

The command verifies every evidence literal against its pinned checkout, then
uses the flake-pinned Repomix release to write 30k and 120k contexts and the
120-row test file under this suite's ignored `.generated/` directory. Smaller
source subtrees receive a bounded public-document supplement for the 30k arm;
the 120k arm adds a larger document set across the pinned public repositories.
The measured token count is recorded on each expanded case. The command can
fetch missing pinned public snapshots; it makes no model requests.

Run `assertion-smoke.yaml` to check every reference answer with Promptfoo's
`echo` provider. `assertion-negative.yaml` is a wrong-answer control; it is
expected to report one pass and one failure.
