// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.37;

contract MockSafe {
    address[] private owners;
    constructor() payable {
        owners.push(msg.sender);
    }
    function getThreshold() external pure returns (uint256) { return 1; }
    function getOwners() external view returns (address[] memory) { return owners; }
    receive() external payable {}
}

contract MockERC20 {
    mapping(address => uint256) private balances;
    function mint(address to, uint256 amount) external { balances[to] += amount; }
    function balanceOf(address who) external view returns (uint256) { return balances[who]; }
}
