{
  "targets": [
    {
      "target_name": "jscronet",
      "sources": ["src/addon.cc"],
      "include_dirs": ["include"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", {
          "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX"],
          "msvs_settings": {
            "VCCLCompilerTool": {"ExceptionHandling": 1}
          }
        }],
        ["OS=='linux'", {
          "cflags_cc": ["-Wno-changes-meaning"],
          "libraries": ["-ldl"]
        }],
        ["OS=='mac'", {
          "cflags_cc": ["-Wno-changes-meaning"]
        }]
      ]
    }
  ]
}
