Object.assign(pc, function () {

    var AnimState = function (name, speed) {
        this.name = name;
        this.animations = [];
        this.speed = speed || 1.0;
    };

    Object.assign(AnimState.prototype, {
        isPlayable: function() {
            return (this.animations.length > 0 || this.name === 'Start' || this.name === 'End');
        },
        getTotalWeight: function() {
            var sum = 0;
            for (var i = 0; i < this.animations.length; i++) {
                sum = sum + this.animations[i].weight;
            }
            return sum;
        }
    });

    var AnimTransition = function (from, to, time, priority) {
        this.from = from;
        this.to = to;
        this.time = time;
        this.priority = priority;
    };

    var AnimController = function (animEvaluator, states, transitions, activate) {
        this.animEvaluator = animEvaluator;
        this.states = states.map(function(state) {
            return new AnimState(state.name, state.speed);
        });
        this.transitions = transitions.map(function(transition) {
            return new AnimTransition(transition.from, transition.to, transition.time, transition.priority);
        });
        this.previousStateName = null;
        this.activeStateName = 'Start';
        this.playing = false;
        this.activate = activate;
        
        this.currTransitionTime = 1.0;
        this.totalTransitionTime = 1.0;
        this.isTransitioning = false;
    };

    Object.assign(AnimController.prototype, {
        _getState: function(stateName) {
            for (var i = 0; i < this.states.length; i++) {
                if (this.states[i].name === stateName) {
                    return this.states[i];
                }
            }
            return null;
        },

        _setState: function(stateName, state) {
            for (var i = 0; i < this.states.length; i++) {
                if (this.states[i].name === stateName) {
                    this.states[i] = state;
                }
            }
        },

        _getActiveState: function() {
            return this._getState(this.activeStateName);
        },

        _setActiveState: function(stateName) {
            return this.activeStateName = stateName;
        },

        _getPreviousState: function() {
            return this._getState(this.previousStateName);
        },

        _setPreviousState: function(stateName) {
            return this.previousStateName = stateName;
        },

        _getActiveStateProgress: function() {
            if (this.activeStateName === 'Start' || this.activeStateName === 'End')
                return 1.0;
            else {
                var activeClip = this.animEvaluator.findClip(this.activeStateName);
                if (activeClip) {
                    return activeClip.time / activeClip.track.duration;
                }
            }
            return null;
        },

        _findTransition: function(from, to) {
            var transitions = this.transitions.filter((function(transition) {
                if (to && from) {
                    return transition.from === from && transition.to === to;
                } else {
                    return transition.from === this.activeStateName;
                }
            }).bind(this));
            if (transitions.length === 0)
                return null;
            else if (transitions.length === 1)
                return transitions[0];
            else {
                transitions.sort(function(a, b) {
                    return a.priority < b.priority;
                });
                return transitions[0];
            }
        },

        _updateStateFromTransition: function(transition) {
            this._setPreviousState(this.activeStateName);
            this._setActiveState(transition.to);

            if (transition.time > 0) {
                this.isTransitioning = true;
                this.totalTransitionTime = transition.time;
                this.currTransitionTime = 0;
            }

            var activeState = this._getActiveState();
            for (var i = 0; i < activeState.animations.length; i++) {
                var clip = this.animEvaluator.findClip(activeState.animations[i].name);
                if (!clip) {
                    clip = new pc.AnimClip(activeState.animations[i].animTrack, 0, activeState.speed, true, true);
                    clip.name = activeState.animations[i].name;
                    this.animEvaluator.addClip(clip);
                }
                if (transition.time > 0) {
                    clip.blendWeight = 0.0 / activeState.getTotalWeight();
                } else {
                    clip.blendWeight = 1.0 / activeState.getTotalWeight();
                }
                clip.reset();
                clip.play();
            }
        },

        _transitionToState: function(newStateName) {
            if (newStateName === this.activeStateName) {
                return;
            }

            if (!this._getState(newStateName)) {
                return;
            }

            var transition = this._findTransition(this.activeStateName, newStateName);
            if (!transition) {
                this.animEvaluator.removeClips();
                transition = new AnimTransition(this.activeStateName, newStateName, 0, 0);
            }
            this._updateStateFromTransition(transition);
        },

        _transitionToNextState: function() {
            var transition = this._findTransition();
            if (!transition) {
                return;
            }
            if (transition.to === 'End')
            {
                this._setActiveState('Start');
                transition = this._findTransition();
            }
            this._updateStateFromTransition(transition);
        },

        linkAnimationToState: function(stateName, animTrack) {
            var state = this._getState(stateName);
            if (!state) {
                console.error('Linking animation asset to animation state that does not exist');
                return;
            }

            var animation = {
                name: animTrack.name,
                animTrack: animTrack,
                weight: 1.0
            };
            state.animations.push(animation);

            if (!this.playing && this.activate && this.isPlayable()) {
                this.play();
            }
        },

        isPlayable: function() {
            var playable = true;
            for (var i = 0; i < this.states.length; i++) {
                if (!this.states[i].isPlayable()) {
                    playable = false;
                }
            }
            return playable;
        },

        play: function(stateName) {
            if (stateName) {
                this._transitionToState(stateName);
            }
            this.playing = true;
        },
        
        update: function(dt) {
            if (this.playing) {
                this.animEvaluator.update(dt);

                var progress = this._getActiveStateProgress();

                if (progress >= 1.0) {
                    this._transitionToNextState();
                }

                if (this.isTransitioning) {
                    if (this.currTransitionTime > this.totalTransitionTime) {
                        this.isTransitioning = false;

                        var previousState = this._getPreviousState();
                        for (var i = 0; i < previousState.animations.length; i++) {
                            var animation = previousState.animations[i];
                            this.animEvaluator.findClip(animation.name).pause();
                            this.animEvaluator.findClip(animation.name).blendWeight = 0;
                        }

                        var activeState = this._getActiveState();
                        for (var i = 0; i < activeState.animations.length; i++) {
                            var animation = activeState.animations[i];
                            this.animEvaluator.findClip(animation.name).blendWeight = animation.weight / activeState.getTotalWeight();
                        }
                    } else {
                        var interpolatedTime = this.currTransitionTime / this.totalTransitionTime;

                        var previousState = this._getPreviousState();
                        for (var i = 0; i < previousState.animations.length; i++) {
                            var animation = previousState.animations[i];
                            this.animEvaluator.findClip(animation.name).blendWeight = (1.0 - interpolatedTime) * animation.weight / previousState.getTotalWeight();
                        }
                        var activeState = this._getActiveState();
                        for (var i = 0; i < activeState.animations.length; i++) {
                            var animation = activeState.animations[i];
                            this.animEvaluator.findClip(animation.name).blendWeight = interpolatedTime * animation.weight / activeState.getTotalWeight();
                        }

                    }
                    this.currTransitionTime = this.currTransitionTime + dt;
                }
            }
        },
    });

    return {
        AnimController: AnimController
    }
}());