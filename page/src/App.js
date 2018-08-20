import React, { Component } from 'react';
import {
  BrowserRouter as Router,
  Route,
  Switch,
} from "react-router-dom";

import Home from 'components/Home';
import PrivacyPolicy from 'components/PrivacyPolicy';
import NoPage from 'components/NoPage';
import 'App.css';

class App extends Component {
  render() {
    return (
      <Router>
        <div className="app">
          <Switch>
          <Route path="/" exact component={Home} />
          <Route path="/privacy-policy" component={PrivacyPolicy} />
          <Route component={NoPage} />
          </Switch>
        </div>
      </Router>
    );
  }
}

export default App;
