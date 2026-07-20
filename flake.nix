{
  description = "Dev shell + org hygiene hooks for dryvist/llm-prompt-evals (promptfoo prompt evaluation)";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-26.05-darwin";
    flake-parts.url = "github:hercules-ci/flake-parts";
    nix-devenv = {
      url = "github:dryvist/nix-devenv";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, nix-devenv, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "x86_64-linux"
        "aarch64-linux"
      ];

      # hygiene-core: the org-wide universal hook set (file hygiene, gitleaks,
      # markdownlint) WITHOUT treefmt — so the hand-authored promptfoo YAML and
      # OKF prompts are never reformatted out from under the eval.
      imports = [ nix-devenv.flakeModules.hygiene-core ];

      perSystem =
        { config, pkgs, ... }:
        let
          # Single source of truth for the eval runner version. Keep in sync with
          # `promptfoo-version:` in .github/workflows/eval.yml.
          #
          # nixpkgs' own `promptfoo` has been frozen at 0.118.14 since 2025-10 on
          # both the stable and unstable channels, so we run it through bun
          # instead: `bun` is the nix-provided binary, `bunx` fetches the exact
          # pinned promptfoo at first use. No custom derivation, no global npm.
          promptfooVersion = "0.121.19";
          promptfooShim = pkgs.writeShellScriptBin "promptfoo" ''
            exec ${pkgs.lib.getExe pkgs.bun} x promptfoo@${promptfooVersion} "$@"
          '';
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [
              promptfooShim # `promptfoo …` -> `bunx promptfoo@<pinned> …`
            ]
            ++ (with pkgs; [
              bun # provides bunx; fetches the pinned promptfoo on first use
              nodejs_22 # scripts/summarize.js
              python3 # prompts/load_okf.py
              pre-commit
              gitleaks
              git
              jq
            ]);

            shellHook = ''
              ${config.pre-commit.installationScript}
              echo "dryvist/llm-prompt-evals dev shell"
              echo ""
              echo "  promptfoo eval -c evals/hermes/promptfooconfig.yaml   run the eval"
              echo "  promptfoo view                                        open the visual report"
              echo "  ./scripts/report.sh                                   eval + JSON/HTML/markdown summary"
            '';
          };
        };
    };
}
