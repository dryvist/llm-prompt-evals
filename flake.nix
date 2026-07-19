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
        {
          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              promptfoo # the eval runner, straight from nixpkgs — no npm
              nodejs_22 # scripts/summarize.js
              python3 # prompts/load_okf.py
              pre-commit
              gitleaks
              git
              jq
            ];

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
