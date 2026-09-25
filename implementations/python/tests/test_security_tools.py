# SPDX-License-Identifier: Apache-2.0
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"scripts"))
from security_tools_fixtures import SUITE, run_case, Fixture
from lifecycle_fixtures import Fixture as LifecycleFixture
from psp_cdl_api_server.security_tools import SecurityToolsService
from psp_cdl_api_server.service import ServiceError

class SecurityToolsTests(unittest.TestCase):
    def test_shared_cases(self):
        for c in SUITE["cases"]:
            for mode in ("http","mcp"):
                with self.subTest(case=c["id"],mode=mode):run_case(c,mode)
    def test_optional_workflow_composition(self):
        f,s=LifecycleFixture(),Fixture()
        try:
            restricted=SecurityToolsService(s,f.service)
            with self.assertRaises(ServiceError) as denied:
                restricted.invoke("listSessions",{"after":None,"limit":10,"status":"all"},"test-owner")
            self.assertEqual((denied.exception.code,denied.exception.status),("FORBIDDEN",403))
            s.principal["scopes"]=[*s.principal["scopes"],*f.principal["scopes"]]
            service=SecurityToolsService(s,f.service)
            self.assertEqual(len(service.operations),14)
            self.assertEqual(len(service.invoke("listSessions",{"after":None,"limit":10,"status":"all"},"test-owner")["result"]["sessions"]),1)
        finally:f.close()
