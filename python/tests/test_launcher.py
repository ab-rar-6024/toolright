import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import toolright  # noqa: E402


class LauncherTests(unittest.TestCase):
    def test_version_matches_pyproject(self):
        here = os.path.dirname(__file__)
        with open(os.path.join(here, "..", "pyproject.toml"), encoding="utf8") as f:
            text = f.read()
        self.assertIn(f'version = "{toolright.__version__}"', text)

    def test_command_pins_the_npm_version_and_passes_args_untouched(self):
        cmd = toolright.build_command("/x/npx", ["lint", "--", "node", "a b.js", "&calc", "$(x)"])
        self.assertEqual(cmd[:3], ["/x/npx", "--yes", f"toolright@{toolright.__version__}"])
        self.assertEqual(cmd[3:], ["lint", "--", "node", "a b.js", "&calc", "$(x)"])

    def test_missing_node_gives_a_clear_message_and_exit_127(self):
        with mock.patch("shutil.which", return_value=None), mock.patch("sys.stderr") as err:
            self.assertEqual(toolright.main(["--version"]), 127)
            self.assertIn("Node.js", "".join(c.args[0] for c in err.write.call_args_list))

    def test_exit_code_is_passed_through(self):
        with mock.patch("shutil.which", side_effect=lambda n: "/bin/" + n), \
             mock.patch("subprocess.call", return_value=3) as call:
            self.assertEqual(toolright.main(["lint"]), 3)
            args, kwargs = call.call_args
            self.assertIsInstance(args[0], list)  # never a shell string
            self.assertNotIn("shell", kwargs)

    def test_refuses_to_recurse(self):
        with mock.patch.dict(os.environ, {"TOOLRIGHT_PY_LAUNCHER": "1"}), \
             mock.patch("subprocess.call") as call, mock.patch("sys.stderr"):
            self.assertEqual(toolright.main(["x"]), 1)
            call.assert_not_called()

    def test_child_gets_the_guard_variable(self):
        with mock.patch("shutil.which", side_effect=lambda n: "/bin/" + n), \
             mock.patch("subprocess.call", return_value=0) as call:
            toolright.main(["list"])
            self.assertEqual(call.call_args.kwargs["env"]["TOOLRIGHT_PY_LAUNCHER"], "1")

    def test_ctrl_c_returns_130(self):
        with mock.patch("shutil.which", side_effect=lambda n: "/bin/" + n), \
             mock.patch("subprocess.call", side_effect=KeyboardInterrupt):
            self.assertEqual(toolright.main(["eval"]), 130)


if __name__ == "__main__":
    unittest.main()
