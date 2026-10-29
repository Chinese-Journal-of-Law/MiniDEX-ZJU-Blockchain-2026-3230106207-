// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    mapping(address => bool) public hasClaimed;

    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {}

    function claim() external {
        require(!hasClaimed[msg.sender], "Already claimed");

        hasClaimed[msg.sender] = true;

        _mint(msg.sender, 1000 * 10 ** decimals());
    }
}