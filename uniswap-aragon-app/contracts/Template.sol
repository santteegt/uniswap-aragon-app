/*
 * SPDX-License-Identitifer:    GPL-3.0-or-later
 *
 * This file requires contract dependencies which are licensed as
 * GPL-3.0-or-later, forcing it to also be licensed as such.
 *
 * This is the only file in your project that requires this license and
 * you are free to choose a different license for the rest of the project.
 */

pragma solidity 0.4.24;

import "@aragon/os/contracts/factory/DAOFactory.sol";
import "@aragon/os/contracts/apm/Repo.sol";
import "@aragon/os/contracts/lib/ens/ENS.sol";
import "@aragon/os/contracts/lib/ens/PublicResolver.sol";
import "@aragon/os/contracts/apm/APMNamehash.sol";

import "@aragon/apps-voting/contracts/Voting.sol";
import "@aragon/apps-token-manager/contracts/TokenManager.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "@aragon/apps-agent/contracts/Agent.sol";

import "./Uniswap.sol";


contract TemplateBase is APMNamehash {
    ENS public ens;
    DAOFactory public fac;

    event DeployInstance(address dao);
    event InstalledApp(address appProxy, bytes32 appId);

    constructor(DAOFactory _fac, ENS _ens) public {
        ens = _ens;

        // If no factory is passed, get it from on-chain bare-kit
        if (address(_fac) == address(0)) {
            bytes32 bareKit = apmNamehash("bare-kit");
            fac = TemplateBase(latestVersionAppBase(bareKit)).fac();
        } else {
            fac = _fac;
        }
    }

    function latestVersionAppBase(bytes32 appId) public view returns (address base) {
        Repo repo = Repo(PublicResolver(ens.resolver(appId)).addr(appId));
        (,base,) = repo.getLatest();

        return base;
    }
}


contract Template is TemplateBase {
    MiniMeTokenFactory tokenFactory;
    address uniswapFactory;
    address[] enabledTokens;

    uint64 constant PCT = 10 ** 16;
    address constant ANY_ENTITY = address(-1);

    constructor(ENS ens, address _uniswapFactory) TemplateBase(DAOFactory(0), ens) public {
        tokenFactory = new MiniMeTokenFactory();
        uniswapFactory = _uniswapFactory;

        enabledTokens.push(address(0x9310dC480CbF907D6A3c41eF2e33B09E61605531));
        enabledTokens.push(address(0xC56a94cB177B297A9f4fe11781CE4E2eD1829f8B));
    }

    function newInstance() public {
        Kernel dao = fac.newDAO(this);
        ACL acl = ACL(dao.acl());
        acl.createPermission(this, dao, dao.APP_MANAGER_ROLE(), this);

        address root = msg.sender;
        bytes32 appId = keccak256(abi.encodePacked(apmNamehash("open"), keccak256("uniswap")));
        bytes32 votingAppId = apmNamehash("voting");
        bytes32 tokenManagerAppId = apmNamehash("token-manager");
        bytes32 agentAppId = apmNamehash("agent");

        Uniswap app = Uniswap(dao.newAppInstance(appId, latestVersionAppBase(appId)));
        Voting voting = Voting(dao.newAppInstance(votingAppId, latestVersionAppBase(votingAppId)));
        TokenManager tokenManager = TokenManager(dao.newAppInstance(tokenManagerAppId, latestVersionAppBase(tokenManagerAppId)));
        Agent agent = Agent(dao.newAppInstance(agentAppId, latestVersionAppBase(agentAppId)));

        MiniMeToken token = tokenFactory.createCloneToken(MiniMeToken(0), 0, "App token", 0, "APP", true);
        token.changeController(tokenManager);

        // Initialize apps
        app.initialize(address(agent), uniswapFactory, enabledTokens);

        tokenManager.initialize(token, true, 0);
        voting.initialize(token, 50 * PCT, 20 * PCT, 1 days);
        agent.initialize();

        // Create apps permissions
        acl.createPermission(ANY_ENTITY, app, app.SET_AGENT_ROLE(), root);
        acl.createPermission(ANY_ENTITY, app, app.SET_UNISWAP_FACTORY_ROLE(), root);
        acl.createPermission(ANY_ENTITY, app, app.SET_UNISWAP_TOKENS_ROLE(), root);
        acl.createPermission(ANY_ENTITY, app, app.TRANSFER_ROLE(), root);
        acl.createPermission(ANY_ENTITY, app, app.ETH_TOKEN_SWAP_ROLE(), root);

        acl.createPermission(this, tokenManager, tokenManager.MINT_ROLE(), this);
        acl.grantPermission(voting, tokenManager, tokenManager.MINT_ROLE());
        tokenManager.mint(root, 1); // Give one token to root

        acl.createPermission(ANY_ENTITY, voting, voting.CREATE_VOTES_ROLE(), root);

        acl.createPermission(address(app), agent, agent.EXECUTE_ROLE(), root);
        acl.createPermission(address(app), agent, agent.SAFE_EXECUTE_ROLE(), root);
        acl.createPermission(address(app), agent, agent.RUN_SCRIPT_ROLE(), root);
        acl.createPermission(address(app), agent, agent.TRANSFER_ROLE(), root);

        // Clean up permissions
        acl.grantPermission(root, dao, dao.APP_MANAGER_ROLE());
        acl.revokePermission(this, dao, dao.APP_MANAGER_ROLE());
        acl.setPermissionManager(root, dao, dao.APP_MANAGER_ROLE());

        acl.grantPermission(root, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.revokePermission(this, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.setPermissionManager(root, acl, acl.CREATE_PERMISSIONS_ROLE());

        emit DeployInstance(dao);
    }
}
