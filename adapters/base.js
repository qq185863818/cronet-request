'use strict';

const { RequestException } = require('../errors');

class BaseAdapter {
  send() { throw new RequestException('BaseAdapter.send() is not implemented'); }
  close() { throw new RequestException('BaseAdapter.close() is not implemented'); }
}

module.exports = { BaseAdapter };
